import { Telegraf, Context, Markup } from "telegraf";
import {
  getOrCreateUser,
  getUserByTelegramId,
  getReferralLink,
  getEarningsByTelegramId,
  getAllUsers,
  recordPurchase,
  logAction,
  formatMoney,
  displayName,
  incrementLinkClick,
  getActiveProducts,
  getProductById,
  createProduct,
  createOrder,
  getRecentOrders,
  getUserState,
  setUserState,
  clearUserState,
  calcStarsByUsername,
  calcAmountWithCommission,
  validateCoupon,
  useCoupon,
  createCoupon,
  deactivateCoupon,
  calcDiscount,
  rubToUsdt,
  getBotSetting,
  setBotSetting,
  getTotalStats,
  getReferralBalance,
  ensureReferralBalanceRow,
  calcDynamicCommissionPercent,
  createWithdrawalRequest,
  getPendingWithdrawals,
  processWithdrawal,
  getTopByRefPurchases,
  getUserLeaderboardRank,
  getPublicProfile,
  getPurchaseRate,
  getReferralBreakdown,
  isAdminInDb,
  addAdminToDb,
  removeAdminFromDb,
  getAdminList,
  createManagedBot,
  getManagedBotById,
  getManagedBotsByOwner,
  getAllManagedBots,
  setManagedBotWelcome,
  createSupportTicket,
  getOpenTicketForUser,
  getTicketById,
  claimTicket,
  closeTicket,
  setTicketNotifiedMessages,
  addSupportMessage,
} from "./helpers";

const ADMIN_ENV_IDS = (process.env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim()))
  .filter((n) => !isNaN(n) && n > 0);
const OWNER_ID = parseInt(process.env.OWNER_TELEGRAM_ID ?? "0");
// Владельцы (полный доступ: товары/купоны/выводы/заказы/боты/настройки).
// OWNER_ID — главный, задан в .env, его нельзя удалить через бота.
const FULL_ADMIN_IDS = Array.from(new Set([OWNER_ID, ...ADMIN_ENV_IDS].filter((n) => n > 0)));
const STARS_RECIPIENT_USERNAME = process.env.STARS_RECIPIENT_USERNAME ?? "";
const FRAGMENT_RATE = parseFloat(process.env.FRAGMENT_RATE_RUB ?? "1.12");
const GIFT_STARS_AMOUNT = parseInt(process.env.GIFT_STARS_AMOUNT ?? "1400");
const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN ?? "";
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL ?? "";
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

export function isOwner(telegramId: number): boolean {
  return FULL_ADMIN_IDS.includes(telegramId);
}

export async function isAdminOrOwner(telegramId: number): Promise<boolean> {
  return isOwner(telegramId) || (await isAdminInDb(telegramId));
}

// ─── Реестр запущенных ботов (главный + созданные пользователями) ─────────────
// Ключ 0 — главный бот. Нужен, чтобы саппорт-тикеты и /reply работали кросс-ботно:
// уведомления админам всегда идут через главный бот, а ответ пользователю
// уходит через тот бот, в котором он изначально написал.
export const botRegistry = new Map<number, Telegraf<Context>>();

export function registerBotInstance(botId: number | null, bot: Telegraf<Context>) {
  botRegistry.set(botId ?? 0, bot);
}

export function getBotInstance(botId: number | null): Telegraf<Context> | undefined {
  return botRegistry.get(botId ?? 0);
}

async function sendViaBot(
  botId: number | null,
  chatId: number,
  text: string,
  extra?: Parameters<Telegraf<Context>["telegram"]["sendMessage"]>[2]
): Promise<boolean> {
  const inst = getBotInstance(botId);
  if (!inst) return false;
  try {
    await inst.telegram.sendMessage(chatId, text, extra);
    return true;
  } catch {
    return false;
  }
}

function blue(text: string): string {
  return `🔵 ${text}`;
}

// ─── Закупочный курс USD→RUB ───────────────────────────────────────────────────
async function getLiveUsdRate(): Promise<number> {
  const envRate = parseFloat(process.env.USD_TO_RUB_RATE ?? "0");
  if (envRate > 0) return getPurchaseRate(envRate);
  try {
    const res = await fetch("https://www.cbr-xml-daily.ru/daily_json.js", { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const rate = data?.Valute?.USD?.Value;
      if (typeof rate === "number" && rate > 0) return getPurchaseRate(rate);
    }
  } catch {
    // fallback
  }
  return 83;
}

async function getOfficialUsdRate(): Promise<number> {
  try {
    const res = await fetch("https://www.cbr-xml-daily.ru/daily_json.js", { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const rate = data?.Valute?.USD?.Value;
      if (typeof rate === "number" && rate > 0) return Math.round(rate);
    }
  } catch {
    // fallback
  }
  return 85;
}

// ─── CryptoBot ──────────────────────────────────────────────────────────────────
async function createCryptoBotInvoice(
  amountUsdt: number,
  description: string,
  payload: string
): Promise<{ invoiceUrl: string; invoiceId: string } | null> {
  if (!CRYPTOBOT_TOKEN) return null;
  try {
    const res = await fetch("https://pay.crypt.bot/api/createInvoice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": CRYPTOBOT_TOKEN },
      body: JSON.stringify({
        asset: "USDT",
        amount: amountUsdt.toFixed(2),
        description,
        payload,
        paid_btn_name: "callback",
        paid_btn_url: `${WEBHOOK_BASE_URL}/api/payment/cryptobot`,
      }),
    });
    const data = await res.json();
    const inv = data.result;
    return { invoiceUrl: inv.pay_url, invoiceId: String(inv.invoice_id) };
  } catch (e) {
    console.error("CryptoBot error:", e);
    return null;
  }
}

// ─── Platega ────────────────────────────────────────────────────────────────────
async function createPlategaInvoice(
  amount: number,
  orderId: string,
  description: string,
  paymentMethod: "sbp" | "card",
  botUsername: string
): Promise<{ paymentUrl: string; paymentId: string } | null> {
  const PLATEGA_MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID ?? "";
  const PLATEGA_SECRET_KEY = process.env.PLATEGA_SECRET_KEY ?? "";
  if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET_KEY) return null;
  try {
    const { v4: uuidv4 } = await import("uuid");
    const txId = uuidv4();
    const methodId = paymentMethod === "sbp" ? 2 : 1;
    const body = {
      id: txId,
      merchant_id: PLATEGA_MERCHANT_ID,
      payment_method: methodId,
      payment_details: { amount, currency: "RUB" },
      description,
      return_url: `https://t.me/${botUsername}`,
      failed_url: `https://t.me/${botUsername}`,
      webhook_url: `${WEBHOOK_BASE_URL}/api/payment/platega`,
      order_id: orderId,
    };
    const crypto = await import("crypto");
    const sign = crypto.createHmac("sha256", PLATEGA_SECRET_KEY).update(JSON.stringify(body)).digest("hex");
    const res = await fetch("https://api.platega.io/v1/transaction/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Merchant-ID": PLATEGA_MERCHANT_ID, "X-Signature": sign },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { paymentUrl: data.redirect ?? data.payment_url ?? data.url ?? "", paymentId: txId };
  } catch (e) {
    console.error("Platega error:", e);
    return null;
  }
}

export interface BotInstanceConfig {
  token: string;
  botId: number | null; // null = главный бот
  botUsername: string;
}

// ─── Создание экземпляра бота (главного или созданного пользователем) ────────
export function createBot(config?: BotInstanceConfig) {
  const token = config?.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "";
  const botId = config?.botId ?? null;
  const botUsername = config?.botUsername ?? process.env.TELEGRAM_BOT_USERNAME ?? "myrefbot";

  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN не задан — бот не запустится");
    return null;
  }

  const bot = new Telegraf(token);
  const isMain = botId === null;

  function refUrlFor(code: string) {
    return `https://t.me/${botUsername}?start=${code}`;
  }

  async function notifyOwners(text: string) {
    for (const adminId of FULL_ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, text, { parse_mode: "HTML" });
      } catch {
        // владелец недоступен
      }
    }
  }

  const mainMenuKeyboard = () =>
    Markup.inlineKeyboard([
      [Markup.button.callback(blue("🛒 Магазин"), "menu_shop")],
      [
        Markup.button.callback(blue("🔗 Реф. ссылка"), "menu_mylink"),
        Markup.button.callback(blue("📊 Статистика"), "menu_mystats"),
      ],
      [
        Markup.button.callback(blue("💰 Баланс"), "menu_balance"),
        Markup.button.callback(blue("💸 Вывод"), "menu_withdraw"),
      ],
      [
        Markup.button.callback(blue("🏆 Топ рефералов"), "menu_top"),
        Markup.button.callback(blue("👤 Профиль"), "menu_profile"),
      ],
      [Markup.button.callback(blue("🤖 Создать своего бота"), "menu_createbot")],
      [Markup.button.callback(blue("🆘 Написать в поддержку"), "menu_support")],
    ]);

  // ─── /start ───────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const { id, username, first_name, last_name } = ctx.from;
    const payload = ctx.startPayload;

    if (payload) {
      await incrementLinkClick(payload).catch(() => {});
    }

    const user = await getOrCreateUser(id, username, first_name, last_name, payload || undefined, botId);
    const link = await getReferralLink(id);
    const refUrl = link ? refUrlFor(link.code) : "—";

    let adminHint = "";
    if (isOwner(id)) {
      adminHint = `\n\n👑 Вы главный владелец бота.\nКоманды: /admin, /addadmin, /deladmin, /admins, /setwelcome`;
    } else if (await isAdminInDb(id)) {
      adminHint = `\n\n🎧 Вы админ поддержки.\nОтвечайте пользователям: /reply <id> <текст>, список тикетов: /tickets`;
    }

    let welcomeTemplate: string;
    let stickerId: string | null = null;

    if (isMain) {
      welcomeTemplate = await getBotSetting(
        "welcome_message",
        `👋 Привет, {name}!\n\n` +
          `Добро пожаловать в наш магазин с реферальной программой.\n\n` +
          `🔗 Ваша реферальная ссылка:\n{ref_url}\n\n` +
          `📢 Делитесь ссылкой и получайте % комиссии с каждой покупки ваших рефералов!\n\n` +
          `Пользуйтесь кнопками ниже 👇`
      );
      stickerId = (await getBotSetting("welcome_sticker_id", "")) || null;
    } else {
      const botRow = await getManagedBotById(botId!);
      welcomeTemplate =
        botRow?.welcomeMessage ??
        (await getBotSetting(
          "welcome_message",
          `👋 Привет, {name}!\n\n🔗 Ваша реферальная ссылка:\n{ref_url}\n\nПользуйтесь кнопками ниже 👇`
        ));
      stickerId = botRow?.welcomeStickerId ?? null;
    }

    const msg = welcomeTemplate.replace(/\{name\}/g, first_name ?? "друг").replace(/\{ref_url\}/g, refUrl) + adminHint;

    if (stickerId) {
      try {
        await ctx.replyWithSticker(stickerId);
      } catch {
        // стикер недоступен — просто пропускаем
      }
    }

    await ctx.replyWithHTML(msg, mainMenuKeyboard());

    if (user.referredBy && (payload || botId)) {
      const referrer = await getUserByTelegramId(user.referredBy);
      const referrerName = displayName(referrer?.username, referrer?.firstName);
      const newUserName = displayName(username, first_name);
      const viaText = payload ? `по ссылке (код: ${payload})` : `через созданного бота @${botUsername}`;
      await notifyOwners(
        `🆕 Новый реферал!\n\n👤 Пользователь: ${newUserName} (${id})\n🔗 Пришёл от: ${referrerName} ${viaText}\n📅 ${new Date().toLocaleString("ru-RU")}`
      );
    }
  });

  // ─── Магазин ──────────────────────────────────────────────────────────────
  async function sendShop(ctx: Context) {
    const prods = await getActiveProducts();
    if (prods.length === 0) {
      await ctx.reply("🛒 Товаров пока нет. Загляните позже!");
      return;
    }
    await ctx.replyWithHTML(
      "🛒 <b>Наш магазин</b>\n\nВыберите товар:",
      Markup.inlineKeyboard(prods.map((p) => [Markup.button.callback(`${p.name} — ${formatMoney(p.price)}`, `product_${p.id}`)]))
    );
  }

  bot.command("shop", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendShop(ctx);
  });
  bot.action("menu_shop", async (ctx) => {
    await ctx.answerCbQuery();
    await sendShop(ctx);
  });

  bot.action(/^product_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);

    if (!product || !product.isActive) {
      await ctx.reply("❌ Товар не найден или снят с продажи.");
      return;
    }

    const usdRate = await getLiveUsdRate();
    const amountRub = parseFloat(product.price);
    const starsUsername = calcStarsByUsername(amountRub, FRAGMENT_RATE);
    const amountUsdt = rubToUsdt(amountRub, usdRate);

    const text =
      `📦 <b>${product.name}</b>\n\n` +
      (product.description ? `📝 ${product.description}\n\n` : "") +
      `💰 Цена: <b>${formatMoney(product.price)}</b>\n\n` +
      `💵 Курс USD: ${usdRate} ₽ (≈ ${amountUsdt} USDT)\n` +
      `⭐ Stars (по юзернейму): ~ ${starsUsername} ⭐\n` +
      `🎁 Stars (подарком): ${GIFT_STARS_AMOUNT} ⭐\n\n` +
      `Выберите способ оплаты:`;

    await ctx.replyWithHTML(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("💳 СБП (+10% комиссия)", `pay_sbp_${productId}`)],
        [Markup.button.callback("🏦 Банковская карта (+10%)", `pay_card_${productId}`)],
        [Markup.button.callback(`🪙 CryptoBot USDT (~${amountUsdt} USDT)`, `pay_crypto_${productId}`)],
        [Markup.button.callback("⭐ Звёзды по юзернейму", `pay_stars_username_${productId}`)],
        [Markup.button.callback(`🎁 Звёзды подарком (${GIFT_STARS_AMOUNT} ⭐)`, `pay_stars_gift_${productId}`)],
        [Markup.button.callback("🏷 Применить купон", `coupon_${productId}`)],
        [Markup.button.callback("◀️ Назад", "back_to_shop")],
      ])
    );
  });

  bot.action("back_to_shop", async (ctx) => {
    await ctx.answerCbQuery();
    await sendShop(ctx);
  });

  bot.action(/^coupon_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const { id } = ctx.from;
    await setUserState(id, "apply_coupon", { productId });
    await ctx.reply("🏷 Введите код купона:");
  });

  bot.action(/^pay_(sbp|card)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const method = (ctx.match as RegExpMatchArray)[1] as "sbp" | "card";
    const productId = parseInt((ctx.match as RegExpMatchArray)[2]);
    await initiatePayment(ctx, productId, method, botUsername, botId);
  });

  bot.action(/^pay_(sbp|card)_coupon_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const method = (ctx.match as RegExpMatchArray)[1] as "sbp" | "card";
    const productId = parseInt((ctx.match as RegExpMatchArray)[2]);
    const couponCode = (ctx.match as RegExpMatchArray)[3];
    await initiatePayment(ctx, productId, method, botUsername, botId, couponCode);
  });

  bot.action(/^pay_crypto_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    await initiatePayment(ctx, productId, "cryptobot", botUsername, botId);
  });

  bot.action(/^pay_crypto_coupon_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const couponCode = (ctx.match as RegExpMatchArray)[2];
    await initiatePayment(ctx, productId, "cryptobot", botUsername, botId, couponCode);
  });

  bot.action(/^pay_stars_username_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);

    const amount = parseFloat(product.price);
    const starsNeeded = calcStarsByUsername(amount, FRAGMENT_RATE);
    const order = await createOrder({ buyerTelegramId: id, productId, amount, paymentMethod: "stars_username", botId: botId ?? undefined });

    const recipient = STARS_RECIPIENT_USERNAME || botUsername;
    await ctx.replyWithHTML(
      `⭐ <b>Оплата звёздами (по юзернейму)</b>\n\n` +
        `📦 Товар: ${product.name}\n` +
        `💰 Сумма: ${formatMoney(amount)}\n` +
        `⭐ Нужно отправить: <b>${starsNeeded} ⭐</b>\n\n` +
        `Отправьте звёзды пользователю @${recipient} через встроенный подарок Stars.\n\n` +
        `❗ ID заказа: <b>${order.id}</b>\n\nПосле отправки нажмите кнопку ниже:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Я отправил звёзды", `stars_sent_${order.id}`)],
        [Markup.button.callback("❌ Отмена", "back_to_shop")],
      ])
    );
  });

  bot.action(/^pay_stars_gift_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);

    const amount = parseFloat(product.price);
    const order = await createOrder({ buyerTelegramId: id, productId, amount, paymentMethod: "stars_gift", botId: botId ?? undefined });
    const recipient = STARS_RECIPIENT_USERNAME || botUsername;

    await ctx.replyWithHTML(
      `🎁 <b>Оплата звёздами (подарком)</b>\n\n` +
        `📦 Товар: ${product.name}\n` +
        `💰 Сумма: ${formatMoney(amount)}\n` +
        `⭐ Подарком: <b>${GIFT_STARS_AMOUNT} ⭐</b>\n\n` +
        `🎁 Отправьте подарок на ${GIFT_STARS_AMOUNT} ⭐ пользователю:\n@${recipient}\n\n` +
        `❗ ID заказа: <b>${order.id}</b>\n(сообщите его администратору для подтверждения)\n\nПосле отправки нажмите кнопку ниже:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Я отправил подарок", `stars_sent_${order.id}`)],
        [Markup.button.callback("❌ Отмена", "back_to_shop")],
      ])
    );
  });

  bot.action(/^stars_sent_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const { id } = ctx.from;

    await notifyOwners(
      `⭐ <b>Запрос на подтверждение Stars-оплаты</b>\n\n👤 Пользователь: ${id}\n🆔 Заказ: #${orderId}\n\nПодтвердить кнопкой ниже.`
    );
    for (const adminId of FULL_ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, `Подтвердить заказ #${orderId}:`, {
          ...Markup.inlineKeyboard([[Markup.button.callback(`✅ Подтвердить #${orderId}`, `admin_confirm_${orderId}`)]]),
        });
      } catch {
        // недоступен
      }
    }

    await ctx.reply(`✅ Запрос отправлен администратору!\n\n🆔 Номер заказа: #${orderId}\n\nОжидайте подтверждения. Обычно это занимает до 24 часов.`);
  });

  bot.action(/^admin_confirm_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const { id } = ctx.from;
    if (!isOwner(id)) {
      await ctx.answerCbQuery("⛔ Доступ запрещён");
      return;
    }
    const { db: dbInst } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const orderRows = await dbInst.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!orderRows[0]) {
      await ctx.reply(`❌ Заказ #${orderId} не найден.`);
      return;
    }
    await deliverOrder(ctx, orderId, orderRows[0].buyerTelegramId);
  });

  // ─── Реферальная ссылка / статистика / баланс / вывод ─────────────────────
  async function sendMyLink(ctx: Context) {
    const { id } = ctx.from!;
    const link = await getReferralLink(id);
    if (!link) {
      await ctx.reply("⚠️ Реферальная ссылка не найдена. Используйте /start");
      return;
    }
    const refUrl = refUrlFor(link.code);
    const balance = await getReferralBalance(id);
    const totalRefPurchases = parseFloat(balance?.totalRefPurchases?.toString() ?? "0");
    const currentPercent = calcDynamicCommissionPercent(totalRefPurchases);
    const breakdown = await getReferralBreakdown(id);

    await ctx.replyWithHTML(
      `🔗 <b>Ваша реферальная ссылка</b>\n\n${refUrl}\n\n` +
        `📊 Статистика\n👆 Кликов: ${link.clickCount}\n👥 Перешло: ${link.referredCount}\n` +
        `   ├ по ссылке: ${breakdown.linkRefs}\n   └ через ваших ботов: ${breakdown.botRefs}\n\n` +
        `💹 Текущая комиссия: <b>${currentPercent}%</b>\n` +
        (totalRefPurchases < 5000
          ? `📈 До повышения до 50%: ещё ${formatMoney(5000 - totalRefPurchases)}\n`
          : `🎉 Максимальный уровень активирован!\n`)
    );
  }
  bot.command("mylink", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendMyLink(ctx);
  });
  bot.action("menu_mylink", async (ctx) => {
    await ctx.answerCbQuery();
    await sendMyLink(ctx);
  });

  async function sendMyStats(ctx: Context) {
    const { id, username, first_name } = ctx.from!;
    await ensureReferralBalanceRow(id, username, first_name);
    const [link, earned, balance] = await Promise.all([getReferralLink(id), getEarningsByTelegramId(id), getReferralBalance(id)]);
    const refUrl = link ? refUrlFor(link.code) : "—";
    const totalRefPurchases = parseFloat(balance?.totalRefPurchases?.toString() ?? "0");
    const currentPercent = calcDynamicCommissionPercent(totalRefPurchases);
    const rank = await getUserLeaderboardRank(id);

    let nextInfo = "";
    if (totalRefPurchases < 5000) {
      nextInfo = `📈 До 50%: ${formatMoney(5000 - totalRefPurchases)}\n`;
    } else {
      const step = Math.floor((totalRefPurchases - 5000) / 1000);
      const nextThreshold = 5000 + (step + 1) * 1000;
      nextInfo = `📈 До ${50 + step + 1}%: ${formatMoney(nextThreshold - totalRefPurchases)}\n`;
    }

    await ctx.replyWithHTML(
      `📊 <b>Ваша статистика</b>\n\n🔗 Реф. ссылка: ${refUrl}\n👥 Привлечено: ${link?.referredCount ?? 0}\n👆 Кликов: ${link?.clickCount ?? 0}\n\n` +
        `💰 Всего заработано: <b>${formatMoney(earned?.totalEarned ?? 0)}</b>\n💎 Текущий баланс: <b>${formatMoney(balance?.balanceRub ?? 0)}</b>\n📤 Выведено: ${formatMoney(balance?.totalWithdrawn ?? 0)}\n\n` +
        `💹 Комиссия: <b>${currentPercent}%</b>\n${nextInfo}\n🏆 Ваше место в рейтинге: #${rank}`
    );
  }
  bot.command("mystats", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendMyStats(ctx);
  });
  bot.action("menu_mystats", async (ctx) => {
    await ctx.answerCbQuery();
    await sendMyStats(ctx);
  });

  async function sendBalance(ctx: Context) {
    const { id, username, first_name } = ctx.from!;
    await ensureReferralBalanceRow(id, username, first_name);
    const balance = await getReferralBalance(id);
    const balanceRub = parseFloat(balance?.balanceRub?.toString() ?? "0");
    const totalWithdrawn = parseFloat(balance?.totalWithdrawn?.toString() ?? "0");
    const totalRefPurchases = parseFloat(balance?.totalRefPurchases?.toString() ?? "0");
    const currentPercent = calcDynamicCommissionPercent(totalRefPurchases);
    const usdRate = await getLiveUsdRate();
    const balanceUsdt = (balanceRub / usdRate).toFixed(2);

    await ctx.replyWithHTML(
      `💰 <b>Ваш баланс</b>\n\n💎 Доступно: <b>${formatMoney(balanceRub)}</b> (~${balanceUsdt} USDT)\n📤 Выведено: ${formatMoney(totalWithdrawn)}\n\n` +
        `💹 Комиссия: ${currentPercent}%\n📊 Объём покупок рефералов: ${formatMoney(totalRefPurchases)}\n\n` +
        (balanceRub >= 100 ? `✅ Минимальная сумма вывода достигнута!\n/withdraw — вывести средства` : `⏳ Минимум для вывода: 100 ₽ (нужно ещё ${formatMoney(100 - balanceRub)})`)
    );
  }
  bot.command("balance", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendBalance(ctx);
  });
  bot.action("menu_balance", async (ctx) => {
    await ctx.answerCbQuery();
    await sendBalance(ctx);
  });

  async function sendWithdraw(ctx: Context) {
    const { id, username, first_name } = ctx.from!;
    await ensureReferralBalanceRow(id, username, first_name);
    const balance = await getReferralBalance(id);
    const balanceRub = parseFloat(balance?.balanceRub?.toString() ?? "0");

    if (balanceRub < 100) {
      await ctx.replyWithHTML(`❌ Недостаточно средств для вывода.\n\n💎 Текущий баланс: <b>${formatMoney(balanceRub)}</b>\n📏 Минимум: 100 ₽\n\nПродолжайте привлекать рефералов!`);
      return;
    }

    const usdRate = await getLiveUsdRate();
    const officialRate = await getOfficialUsdRate();
    const balanceUsdt = rubToUsdt(balanceRub, usdRate);

    await ctx.replyWithHTML(
      `💸 <b>Вывод средств</b>\n\n💎 Доступно: <b>${formatMoney(balanceRub)}</b>\n💵 USDT (~${balanceUsdt} USDT)\n\n💱 Курс закупочный: ${usdRate} ₽/$ (ЦБ: ${officialRate} ₽)\n\n⏰ Срок обработки: до 48 часов\n💳 Выплата в USDT через CryptoBot\n\nПодтвердите вывод всей суммы:`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Вывести ${formatMoney(balanceRub)}`, `confirm_withdraw_${balanceRub}_${balanceUsdt}_${usdRate}`)],
        [Markup.button.callback("❌ Отмена", "cancel_withdraw")],
      ])
    );
  }
  bot.command("withdraw", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendWithdraw(ctx);
  });
  bot.action("menu_withdraw", async (ctx) => {
    await ctx.answerCbQuery();
    await sendWithdraw(ctx);
  });

  bot.action(/^confirm_withdraw_(\d+\.?\d*)_(\d+\.?\d*)_(\d+\.?\d*)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const { id, username, first_name } = ctx.from;
    const m = ctx.match as RegExpMatchArray;
    const amountRub = parseFloat(m[1]);
    const amountUsdt = parseFloat(m[2]);
    const rate = parseFloat(m[3]);

    const result = await createWithdrawalRequest({ telegramId: id, username, firstName: first_name, amountRub, amountUsdt, rateUsed: rate });
    if (!result.success) {
      await ctx.reply(`❌ ${result.error}`);
      return;
    }

    await notifyOwners(
      `💸 <b>Новая заявка на вывод #${result.request!.id}</b>\n\n👤 ${displayName(username, first_name)} ${id}\n💰 ${formatMoney(amountRub)} = ${amountUsdt} USDT\n💱 Курс: ${rate} ₽/$\n\n` +
        `/admin_pay_withdrawal ${result.request!.id} [чек] — выплатить\n/admin_reject_withdrawal ${result.request!.id} — отклонить`
    );

    await ctx.replyWithHTML(
      `✅ <b>Заявка на вывод принята!</b>\n\n🆔 Номер заявки: #${result.request!.id}\n💰 Сумма: ${formatMoney(amountRub)}\n💵 USDT: ${amountUsdt} USDT\n\n🕐 Обработка до 48 часов\nВы получите уведомление о выплате.`
    );
    await logAction(id, username, "WITHDRAW_REQUEST", `${amountRub}₽ = ${amountUsdt}USDT`);
  });

  bot.action("cancel_withdraw", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("❌ Вывод отменён. /balance — ваш баланс");
  });

  async function sendTop(ctx: Context) {
    const top = await getTopByRefPurchases(5);
    if (top.length === 0) {
      await ctx.reply("🏆 Рейтинг пуст. Будьте первым!");
      return;
    }
    let text = `🏆 <b>Топ-5 рефералов</b>\n\n`;
    top.forEach((entry, i) => {
      const name = displayName(entry.username, entry.firstName);
      const totalPurchases = formatMoney(entry.totalRefPurchases);
      const pct = calcDynamicCommissionPercent(parseFloat(entry.totalRefPurchases?.toString() ?? "0"));
      text += `${MEDALS[i]} ${name}\n   💰 ${totalPurchases} | ${pct}%\n\n`;
    });
    await ctx.replyWithHTML(text);
  }
  bot.command("statistics", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendTop(ctx);
  });
  bot.action("menu_top", async (ctx) => {
    await ctx.answerCbQuery();
    await sendTop(ctx);
  });

  async function sendProfile(ctx: Context) {
    const { id } = ctx.from!;
    const profile = await getPublicProfile(id);
    if (!profile) {
      await ctx.reply("❌ Профиль не найден.");
      return;
    }
    await ctx.replyWithHTML(
      `👤 <b>Профиль</b>\n\n📛 Имя: ${displayName(profile.username, profile.firstName)}\n📅 В боте с: ${new Date(profile.joinedAt).toLocaleDateString("ru-RU")}\n\n` +
        `🔗 Код: <code>${profile.referralCode ?? "нет"}</code>\n👆 Кликов: ${profile.clickCount}\n👥 Рефералов: ${profile.referredCount} (по ссылке: ${profile.breakdown.linkRefs}, через ботов: ${profile.breakdown.botRefs})\n` +
        `🛒 Покупок рефералов: ${profile.refPurchasesCount} на ${formatMoney(profile.refRevenue)}\n💹 Комиссия: ${profile.commissionPercent}%\n🏆 Место в рейтинге: #${profile.rank}\n\n` +
        `🌍 Публичная страница: ${WEBHOOK_BASE_URL || "https://ваш-домен"}/profile/${id}`
    );
  }
  bot.command("profile", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);
    await sendProfile(ctx);
  });
  bot.action("menu_profile", async (ctx) => {
    await ctx.answerCbQuery();
    await sendProfile(ctx);
  });

  bot.action("menu_support", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("✍️ Просто напишите ваш вопрос обычным сообщением — мы передадим его в поддержку.");
  });

  // ─── Создание собственного бота ────────────────────────────────────────────
  bot.command("createbot", async (ctx) => {
    const { id } = ctx.from;
    await setUserState(id, "createbot_await_token", {});
    await ctx.replyWithHTML(
      `🤖 <b>Создание собственного бота</b>\n\n` +
        `1. Откройте @BotFather → /newbot → придумайте имя и username\n` +
        `2. Скопируйте выданный токен вида <code>123456789:AAExampleToken</code>\n` +
        `3. Отправьте его сюда сообщением\n\n` +
        `Ваш бот будет работать так же, как этот: магазин, реф. ссылки, поддержка через админов этого бота. ` +
        `Все, кто напишет /start вашему боту без своей ссылки, автоматически станут вашими рефералами (тип «через бота»).\n\n` +
        `Отправьте /cancel чтобы отменить.`
    );
  });

  bot.command("mybots", async (ctx) => {
    const { id } = ctx.from;
    const list = await getManagedBotsByOwner(id);
    if (list.length === 0) {
      await ctx.reply("У вас пока нет созданных ботов. Используйте /createbot чтобы создать.");
      return;
    }
    let text = `🤖 <b>Ваши боты (${list.length})</b>\n\n`;
    for (const b of list) {
      text += `${b.isActive ? "✅" : "⛔️"} @${b.botUsername}\n   Создан: ${new Date(b.createdAt).toLocaleDateString("ru-RU")}\n\n`;
    }
    await ctx.replyWithHTML(text);
  });

  bot.action("menu_createbot", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    await setUserState(id, "createbot_await_token", {});
    await ctx.replyWithHTML(
      `🤖 <b>Создание собственного бота</b>\n\nОтправьте токен бота, полученный от @BotFather.\n\nОтправьте /cancel чтобы отменить.`
    );
  });

  bot.command("cancel", async (ctx) => {
    await clearUserState(ctx.from.id);
    await ctx.reply("❌ Действие отменено.");
  });

  // ─── Иерархия админов ───────────────────────────────────────────────────────
  bot.command("addadmin", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return ctx.reply("⛔ Только главный владелец может добавлять админов.");
    const targetId = parseInt(ctx.message.text.split(" ")[1]);
    if (!targetId) return ctx.reply("Использование: /addadmin <telegram_id>");
    if (isOwner(targetId)) return ctx.reply("Это и так владелец.");
    await addAdminToDb(targetId, undefined, id);
    await ctx.reply(`✅ ${targetId} назначен админом поддержки.`);
    try {
      await bot.telegram.sendMessage(
        targetId,
        "🎉 Вас назначили админом поддержки!\n\nВы будете получать вопросы от пользователей всех наших ботов.\nОтвечайте командой: /reply <id_тикета> <текст>\nСписок тикетов: /tickets"
      );
    } catch {
      // пользователь ещё не запускал бота
    }
  });

  bot.command("deladmin", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return ctx.reply("⛔ Только главный владелец может удалять админов.");
    const targetId = parseInt(ctx.message.text.split(" ")[1]);
    if (!targetId) return ctx.reply("Использование: /deladmin <telegram_id>");
    if (isOwner(targetId)) return ctx.reply("⛔ Владельца удалить нельзя.");
    await removeAdminFromDb(targetId);
    await ctx.reply(`✅ ${targetId} больше не админ.`);
  });

  bot.command("admins", async (ctx) => {
    const { id } = ctx.from;
    if (!(await isAdminOrOwner(id))) return;
    const list = await getAdminList();
    const ownersText = FULL_ADMIN_IDS.map((o) => `👑 ${o}${o === OWNER_ID ? " (главный)" : ""}`).join("\n");
    const text = `${ownersText}\n\n${list.length ? list.map((a) => `🎧 ${a.telegramId}${a.username ? " @" + a.username : ""}`).join("\n") : "Обычных админов пока нет."}`;
    await ctx.replyWithHTML(text);
  });

  // ─── Поддержка: тикеты и /reply ────────────────────────────────────────────
  bot.command("tickets", async (ctx) => {
    const { id } = ctx.from;
    if (!(await isAdminOrOwner(id))) return;
    const { getOpenTickets } = await import("./helpers");
    const list = await getOpenTickets();
    if (list.length === 0) {
      await ctx.reply("✅ Открытых обращений нет.");
      return;
    }
    let text = `🆘 <b>Обращения (${list.length})</b>\n\n`;
    for (const t of list) {
      const statusEmoji = t.status === "open" ? "🟦" : "🟡";
      text += `${statusEmoji} #${t.id} — ${displayName(t.fromUsername, t.fromFirstName)} (${t.fromTelegramId})\n   Бот: ${t.botUsername ?? "главный"}\n   ${t.status === "claimed" ? `Взял: @${t.claimedByUsername ?? t.claimedByAdminId}` : "Ожидает"}\n   /reply ${t.id} <текст>\n\n`;
    }
    await ctx.replyWithHTML(text);
  });

  bot.action(/^ticket_claim_(\d+)$/, async (ctx) => {
    const ticketId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const { id, username } = ctx.from;
    if (!(await isAdminOrOwner(id))) {
      await ctx.answerCbQuery("⛔ Только для админов поддержки");
      return;
    }
    const ticket = await claimTicket(ticketId, id, username);
    if (!ticket) {
      await ctx.answerCbQuery("⚠️ Уже взято другим админом");
      return;
    }
    await ctx.answerCbQuery("✅ Тикет взят в работу!");

    try {
      await ctx.editMessageText(
        `✅ Тикет #${ticketId} взят в работу вами (@${username ?? id}).\n\nОтвечайте: /reply ${ticketId} <текст>\nЗакрыть: /close ${ticketId}`
      );
    } catch {
      // сообщение уже изменено
    }

    const notified = (ticket.notifiedMessages as Record<string, number>) ?? {};
    const mainBot = getBotInstance(null);
    if (mainBot) {
      for (const [adminIdStr, msgId] of Object.entries(notified)) {
        const adminIdNum = parseInt(adminIdStr);
        if (adminIdNum === id) continue;
        try {
          await mainBot.telegram.editMessageText(
            adminIdNum,
            msgId,
            undefined,
            `🔒 Тикет #${ticketId} уже взят в работу админом @${username ?? id}.`
          );
        } catch {
          // не удалось отредактировать (сообщение могло быть удалено)
        }
      }
    }

    await sendViaBot(ticket.botId, ticket.fromTelegramId, "🟢 Специалист поддержки подключился к диалогу! Ожидайте ответ.");
  });

  bot.hears(/^\/reply (\d+) ([\s\S]+)$/, async (ctx) => {
    const { id, username } = ctx.from;
    if (!(await isAdminOrOwner(id))) return;
    const ticketId = parseInt(ctx.match[1]);
    const replyText = ctx.match[2];

    const ticket = await getTicketById(ticketId);
    if (!ticket) return ctx.reply("❌ Тикет не найден.");
    if (ticket.status === "closed") return ctx.reply("⚠️ Этот тикет уже закрыт.");

    if (!ticket.claimedByAdminId) {
      await claimTicket(ticketId, id, username);
    } else if (ticket.claimedByAdminId !== id && !isOwner(id)) {
      return ctx.reply(`⛔ Тикет уже занят админом @${ticket.claimedByUsername ?? ticket.claimedByAdminId}.`);
    }

    const sent = await sendViaBot(ticket.botId, ticket.fromTelegramId, `💬 Ответ поддержки:\n\n${replyText}`);
    await addSupportMessage({ ticketId, senderTelegramId: id, senderRole: "admin", senderUsername: username, text: replyText });

    if (sent) await ctx.reply("✅ Отправлено.");
    else await ctx.reply("❌ Не удалось отправить — пользователь недоступен или бот не запущен.");
  });

  bot.hears(/^\/close (\d+)$/, async (ctx) => {
    const { id } = ctx.from;
    if (!(await isAdminOrOwner(id))) return;
    const ticketId = parseInt(ctx.match[1]);
    const ticket = await getTicketById(ticketId);
    if (!ticket) return ctx.reply("❌ Тикет не найден.");
    await closeTicket(ticketId);
    await sendViaBot(ticket.botId, ticket.fromTelegramId, "✅ Ваше обращение закрыто. Если появится новый вопрос — просто напишите сообщение.");
    await ctx.reply(`✅ Тикет #${ticketId} закрыт.`);
  });

  // ─── Настройка приветствия (только владелец) ───────────────────────────────
  bot.command("setwelcome", async (ctx) => {
    const { id } = ctx.from;
    const isBotOwner = botId ? (await getManagedBotById(botId))?.ownerTelegramId === id : false;
    if (!isOwner(id) && !isBotOwner) return ctx.reply("⛔ Только владелец бота может изменить приветствие.");
    await setUserState(id, "await_welcome_text", {});
    await ctx.replyWithHTML(
      `✏️ Отправьте новый текст приветствия.\n\nПеременные: <code>{name}</code> — имя пользователя, <code>{ref_url}</code> — реферальная ссылка.\nМожно использовать HTML-разметку.`
    );
  });

  // ─── Владелец: управление магазином ────────────────────────────────────────
  bot.command("admin", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    await ctx.replyWithHTML(
      `🔧 <b>Панель владельца</b>\n\n` +
        `/admin_products — список товаров\n/admin_add_product — добавить товар\n` +
        `/admin_coupons — список купонов\n/admin_add_coupon — добавить купон\n` +
        `/admin_stats — статистика\n/admin_users — пользователи\n/admin_orders — заказы\n` +
        `/admin_withdrawals — заявки на вывод\n/admin_bots — созданные пользователями боты\n` +
        `/addadmin <id> — добавить админа поддержки\n/deladmin <id> — удалить админа\n/admins — список админов\n` +
        `/setwelcome — изменить приветствие\n/tickets — обращения поддержки`
    );
  });

  bot.command("admin_products", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const { getAllProductsAdmin } = await import("./helpers");
    const prods = await getAllProductsAdmin();
    if (prods.length === 0) return ctx.reply("Товаров нет. /admin_add_product");
    let text = `📦 <b>Товары (${prods.length})</b>\n\n`;
    for (const p of prods) {
      text += `${p.isActive ? "✅" : "⛔️"} #${p.id} ${p.name} — ${formatMoney(p.price)} (${p.productType})\n`;
    }
    await ctx.replyWithHTML(text);
  });

  bot.command("admin_add_product", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    await setUserState(id, "admin_add_product_name", {});
    await ctx.reply("Шаг 1/4: Введите название товара:");
  });

  bot.command("admin_coupons", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const { getAllCoupons } = await import("./helpers");
    const list = await getAllCoupons();
    if (list.length === 0) return ctx.reply("Купонов нет. /admin_add_coupon");
    let text = `🏷 <b>Купоны (${list.length})</b>\n\n`;
    for (const c of list) {
      const discount = c.discountType === "fixed" ? `${formatMoney(c.discountFixed)}` : `${c.discountPercent}%`;
      text += `${c.isActive ? "✅" : "⛔️"} <code>${c.code}</code> — ${discount} (исп. ${c.usageCount}/${c.usageLimit || "∞"})\n`;
    }
    await ctx.replyWithHTML(text);
  });

  bot.command("admin_add_coupon", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    await setUserState(id, "admin_add_coupon_code", {});
    await ctx.reply("Шаг 1/5: Введите код купона (например: SALE20):");
  });

  bot.command("admin_stats", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const stats = await getTotalStats();
    await ctx.replyWithHTML(
      `📊 <b>Полная статистика</b>\n\n👥 Пользователей: ${stats.users}\n🔗 Реф. ссылок: ${stats.links}\n🤖 Активных ботов: ${stats.activeBots}\n` +
        `🛒 Покупок: ${stats.purchases}\n✅ Оплаченных заказов: ${stats.paidOrders}\n💰 Выручка (заказы): ${formatMoney(stats.ordersRevenue)}\n` +
        `💵 Общая выручка: ${formatMoney(stats.totalRevenue)}\n💎 Комиссий начислено: ${formatMoney(stats.totalCommissions)}\n📤 Выплачено: ${formatMoney(stats.totalPaidOut)}\n` +
        `⏳ Ожид. выводов: ${stats.pendingWithdrawals}\n🆘 Открытых тикетов: ${stats.openTickets}`
    );
  });

  bot.command("admin_users", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const allUsers = await getAllUsers();
    let text = `👥 <b>Пользователи (${allUsers.length})</b>\n\n`;
    for (const u of allUsers.slice(0, 15)) {
      text += `${displayName(u.username, u.firstName)} (${u.telegramId})\n   Присоединился: ${new Date(u.joinedAt).toLocaleDateString("ru-RU")}\n\n`;
    }
    if (allUsers.length > 15) text += `...и ещё ${allUsers.length - 15}\n`;
    await ctx.replyWithHTML(text);
  });

  bot.command("admin_orders", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const recentOrders = await getRecentOrders(10);
    if (recentOrders.length === 0) return ctx.reply("📋 Заказов нет.");
    let text = `📋 <b>Последние заказы</b>\n\n`;
    for (const o of recentOrders) {
      const statusEmoji = o.status === "paid" ? "✅" : o.status === "pending" ? "⏳" : "❌";
      text += `${statusEmoji} #${o.id} — ${formatMoney(o.amount)}\n   👤 ${o.buyerTelegramId} | ${o.paymentMethod}\n   📅 ${new Date(o.createdAt).toLocaleDateString("ru-RU")}\n` + (o.status === "pending" ? `   /admin_confirm_order ${o.id}\n` : "") + `\n`;
    }
    await ctx.replyWithHTML(text);
  });

  bot.hears(/^\/admin_confirm_order (\d+)$/, async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const orderId = parseInt(ctx.match[1]);
    const { db: dbInst } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const orderRows = await dbInst.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!orderRows[0]) return ctx.reply(`❌ Заказ #${orderId} не найден.`);
    await deliverOrder(ctx, orderId, orderRows[0].buyerTelegramId);
  });

  bot.command("admin_withdrawals", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const pending = await getPendingWithdrawals();
    if (pending.length === 0) return ctx.reply("✅ Заявок на вывод нет.");
    let text = `⏳ <b>Ожидают вывода (${pending.length})</b>\n\n`;
    for (const wd of pending) {
      text += `#${wd.id} — ${displayName(wd.username, wd.firstName)} (${wd.telegramId})\n   💰 ${formatMoney(wd.amountRub)} = ${wd.amountUsdt} USDT\n   💱 Курс: ${wd.rateUsed} ₽/$\n   /admin_pay_withdrawal ${wd.id} [чек]\n   /admin_reject_withdrawal ${wd.id}\n\n`;
    }
    await ctx.replyWithHTML(text);
  });

  bot.hears(/^\/admin_pay_withdrawal (\d+)(.*)$/, async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const wdId = parseInt(ctx.match[1]);
    const cryptoCheck = ctx.match[2]?.trim() || undefined;
    const req = await processWithdrawal(wdId, "paid", cryptoCheck, "Выплачено администратором");
    if (!req) return ctx.reply(`❌ Заявка #${wdId} не найдена.`);
    try {
      await bot.telegram.sendMessage(
        req.telegramId,
        `✅ Выплата произведена!\n\n🆔 Заявка: #${wdId}\n💰 Сумма: ${formatMoney(req.amountRub)}\n💵 USDT: ${req.amountUsdt}\n` + (cryptoCheck ? `🎁 Чек: ${cryptoCheck}\n` : "") + `\nСпасибо за работу! /balance`
      );
    } catch {
      // недоступен
    }
    await ctx.reply(`✅ Заявка #${wdId} выплачена. Пользователь уведомлён.`);
  });

  bot.hears(/^\/admin_reject_withdrawal (\d+)(.*)$/, async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const wdId = parseInt(ctx.match[1]);
    const note = ctx.match[2]?.trim() || "Отклонено администратором";
    const req = await processWithdrawal(wdId, "rejected", undefined, note);
    if (!req) return ctx.reply(`❌ Заявка #${wdId} не найдена.`);
    try {
      await bot.telegram.sendMessage(
        req.telegramId,
        `❌ Заявка на вывод отклонена\n\n🆔 Заявка: #${wdId}\n💰 Сумма: ${formatMoney(req.amountRub)} (возвращена на баланс)\n📝 Причина: ${note}\n\n/balance — ваш баланс`
      );
    } catch {
      // недоступен
    }
    await ctx.reply(`❌ Заявка #${wdId} отклонена. Средства возвращены на баланс.`);
  });

  bot.command("admin_bots", async (ctx) => {
    const { id } = ctx.from;
    if (!isOwner(id)) return;
    const list = await getAllManagedBots();
    if (list.length === 0) return ctx.reply("Пока никто не создал своего бота.");
    let text = `🤖 <b>Созданные боты (${list.length})</b>\n\n`;
    for (const b of list) {
      text += `${b.isActive ? "✅" : "⛔️"} @${b.botUsername} — владелец ${b.ownerTelegramId}${b.ownerUsername ? " (@" + b.ownerUsername + ")" : ""}\n`;
    }
    await ctx.replyWithHTML(text);
  });

  // ─── Обработка текстовых сообщений (FSM + пересылка в поддержку) ──────────
  bot.on("text", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return; // неизвестная команда — игнорируем

    const stateRow = await getUserState(id);
    const state = stateRow?.state;
    const data = (stateRow?.data ?? {}) as Record<string, unknown>;

    // ── Применение купона ────────────────────────────────────────────────
    if (state === "apply_coupon") {
      const productId = data.productId as number;
      const code = text.toUpperCase().trim();
      const result = await validateCoupon(code, productId);
      await clearUserState(id);
      if (!result.valid || !result.coupon) return ctx.reply(`❌ ${result.error}`);

      const coupon = result.coupon;
      const product = await getProductById(productId);
      if (!product) return ctx.reply("❌ Товар не найден.");

      const baseAmount = parseFloat(product.price);
      const discountAmt = calcDiscount(coupon, baseAmount);
      const finalAmount = +(baseAmount - discountAmt).toFixed(2);
      const discountStr = coupon.discountType === "fixed" ? `-${formatMoney(discountAmt)}` : `-${coupon.discountPercent}%`;

      await ctx.replyWithHTML(
        `✅ <b>Купон применён!</b>\n\n🏷 Код: <code>${coupon.code}</code>\n💸 Скидка: ${discountStr}\n💰 Итого: <b>${formatMoney(finalAmount)}</b>\n\nВыберите способ оплаты:`,
        Markup.inlineKeyboard([
          [Markup.button.callback(`💳 СБП (+10%)`, `pay_sbp_coupon_${productId}_${coupon.code}`)],
          [Markup.button.callback(`🏦 Карта (+10%)`, `pay_card_coupon_${productId}_${coupon.code}`)],
          [Markup.button.callback(`🪙 CryptoBot`, `pay_crypto_coupon_${productId}_${coupon.code}`)],
          [Markup.button.callback("◀️ Назад", "back_to_shop")],
        ])
      );
      return;
    }

    // ── Создание своего бота: приём токена ──────────────────────────────
    if (state === "createbot_await_token") {
      const tokenCandidate = text.trim();
      if (!/^\d{6,12}:[A-Za-z0-9_-]{30,45}$/.test(tokenCandidate)) {
        await ctx.reply("⚠️ Похоже, это не токен от @BotFather. Проверьте и отправьте ещё раз, либо /cancel.");
        return;
      }
      try {
        const res = await fetch(`https://api.telegram.org/bot${tokenCandidate}/getMe`, { signal: AbortSignal.timeout(8000) });
        const info = await res.json();
        if (!info.ok) {
          await ctx.reply("❌ Токен недействителен. Проверьте и попробуйте снова, либо /cancel.");
          return;
        }
        await clearUserState(id);
        const row = await createManagedBot({
          ownerTelegramId: id,
          ownerUsername: username,
          token: tokenCandidate,
          botUsername: info.result.username,
          botFirstName: info.result.first_name,
        });
        if (!row) {
          await ctx.reply("⚠️ Этот бот уже был добавлен ранее.");
          return;
        }
        const { launchManagedBot } = await import("./manager");
        await launchManagedBot(row).catch((e) => console.error("Ошибка запуска нового бота:", e));

        await ctx.replyWithHTML(
          `🎉 <b>Готово! Ваш бот запущен:</b> @${info.result.username}\n\n` +
            `🔗 https://t.me/${info.result.username}\n\n` +
            `Он работает так же, как этот бот: магазин, реферальная система, поддержка.\n` +
            `Все пользователи, зашедшие в него без своей ссылки, автоматически станут вашими рефералами.\n` +
            `Изменить приветствие вашего бота: команда /setwelcome — прямо в нём.\n` +
            `Список ваших ботов: /mybots`
        );
      } catch (e) {
        console.error("createbot error:", e);
        await ctx.reply("❌ Не удалось проверить токен. Попробуйте позже, либо /cancel.");
      }
      return;
    }

    // ── Настройка приветствия: текст ────────────────────────────────────
    if (state === "await_welcome_text") {
      data.welcomeText = text;
      await setUserState(id, "await_welcome_sticker", data);
      await ctx.replyWithHTML(
        `👍 Текст сохранён (пока черновик).\n\nТеперь отправьте стикер (в т.ч. Premium), который будет показываться перед приветствием, либо отправьте «-» чтобы обойтись без стикера.`
      );
      return;
    }

    // ── Настройка приветствия: пропуск стикера текстом "-" ──────────────
    if (state === "await_welcome_sticker" && text === "-") {
      const welcomeText = data.welcomeText as string;
      await clearUserState(id);
      if (isMain) {
        await setBotSetting("welcome_message", welcomeText);
        await setBotSetting("welcome_sticker_id", "");
      } else if (botId) {
        await setManagedBotWelcome(botId, welcomeText, null);
      }
      await ctx.reply("✅ Приветствие обновлено (без стикера).");
      return;
    }

    // ── Товары: добавление (пошагово) ────────────────────────────────────
    if (state === "admin_add_product_name") {
      if (!isOwner(id)) return clearUserState(id);
      data.name = text;
      await setUserState(id, "admin_add_product_desc", data);
      await ctx.reply("Шаг 2/4: Введите описание (или «-» пропустить):");
      return;
    }
    if (state === "admin_add_product_desc") {
      if (!isOwner(id)) return clearUserState(id);
      data.description = text === "-" ? null : text;
      await setUserState(id, "admin_add_product_price", data);
      await ctx.reply("Шаг 3/4: Введите цену в рублях (например: 1500):");
      return;
    }
    if (state === "admin_add_product_price") {
      if (!isOwner(id)) return clearUserState(id);
      const price = parseFloat(text.replace(",", "."));
      if (isNaN(price) || price <= 0) return ctx.reply("⚠️ Введите корректную цену (число > 0).");
      data.price = price;
      await setUserState(id, "admin_add_product_type", data);
      await ctx.replyWithHTML(
        "Шаг 4/4: Выберите тип товара:",
        Markup.inlineKeyboard([
          [Markup.button.callback("🔗 Ссылка-приглашение в канал", "product_type_invite_link")],
          [Markup.button.callback("📄 Цифровой контент (текст)", "product_type_digital")],
        ])
      );
      return;
    }
    if (state === "admin_add_product_channel") {
      if (!isOwner(id)) return clearUserState(id);
      data.channelId = text;
      const product = await createProduct({
        name: data.name as string,
        description: data.description as string | null,
        price: data.price as number,
        productType: "invite_link",
        channelId: text,
      });
      await clearUserState(id);
      await ctx.replyWithHTML(`✅ <b>Товар добавлен!</b>\n\n🆔 ID: ${product.id}\n📦 ${product.name}\n💵 ${formatMoney(product.price)}\n\nСписок: /admin_products`);
      return;
    }
    if (state === "admin_add_product_digital") {
      if (!isOwner(id)) return clearUserState(id);
      const product = await createProduct({
        name: data.name as string,
        description: data.description as string | null,
        price: data.price as number,
        productType: "digital",
        digitalContent: text,
      });
      await clearUserState(id);
      await ctx.replyWithHTML(`✅ <b>Товар добавлен!</b>\n\n🆔 ID: ${product.id}\n📦 ${product.name}\n💵 ${formatMoney(product.price)}\n\nСписок: /admin_products`);
      return;
    }

    // ── Купоны: добавление (пошагово) ─────────────────────────────────────
    if (state === "admin_add_coupon_code") {
      if (!isOwner(id)) return clearUserState(id);
      data.code = text.toUpperCase();
      await setUserState(id, "admin_add_coupon_dtype", data);
      await ctx.replyWithHTML(
        "Шаг 2/5: Тип скидки:",
        Markup.inlineKeyboard([
          [Markup.button.callback("Процент", "coupon_dtype_percent")],
          [Markup.button.callback("Фиксированная сумма", "coupon_dtype_fixed")],
        ])
      );
      return;
    }
    if (state === "admin_add_coupon_discount_value") {
      if (!isOwner(id)) return clearUserState(id);
      const value = parseFloat(text.replace(",", "."));
      if (isNaN(value) || value <= 0) return ctx.reply("⚠️ Введите корректное число.");
      if (data.discountType === "percent") data.discountPercent = value;
      else data.discountFixed = value;
      await setUserState(id, "admin_add_coupon_ltype", data);
      await ctx.replyWithHTML(
        "Шаг 4/5: Тип ограничения:",
        Markup.inlineKeyboard([
          [Markup.button.callback("По числу активаций", "coupon_ltype_activations")],
          [Markup.button.callback("По сумме скидок", "coupon_ltype_amount")],
          [Markup.button.callback("По времени (дней)", "coupon_ltype_time")],
        ])
      );
      return;
    }
    if (state === "admin_add_coupon_limit_value") {
      if (!isOwner(id)) return clearUserState(id);
      const value = parseFloat(text.replace(",", "."));
      if (isNaN(value) || value < 0) return ctx.reply("⚠️ Введите корректное число.");

      let expiresAt: Date | undefined;
      if (data.limitType === "time") {
        expiresAt = new Date(Date.now() + value * 24 * 60 * 60 * 1000);
      }

      const coupon = await createCoupon({
        code: data.code as string,
        discountType: data.discountType as string,
        discountPercent: (data.discountPercent as number) ?? 0,
        discountFixed: (data.discountFixed as number) ?? 0,
        limitType: data.limitType as string,
        usageLimit: data.limitType === "activations" ? value : 0,
        maxDiscountAmount: data.limitType === "amount" ? value : 0,
        expiresAt,
      });
      await clearUserState(id);
      await ctx.replyWithHTML(`✅ <b>Купон создан!</b>\n\n🏷 Код: <code>${coupon.code}</code>\n\nСписок: /admin_coupons`);
      return;
    }

    // ── Ничего не подошло — обращение в поддержку ─────────────────────────
    if (await isAdminOrOwner(id)) return; // сообщения от админов не форвардим

    await getOrCreateUser(id, username, first_name, undefined, undefined, botId);

    let ticket = await getOpenTicketForUser(id, botId);
    if (!ticket) {
      ticket = await createSupportTicket({ botId, botUsername: isMain ? undefined : botUsername, fromTelegramId: id, fromUsername: username, fromFirstName: first_name });
    }

    await addSupportMessage({ ticketId: ticket.id, senderTelegramId: id, senderRole: "user", senderUsername: username, text });

    if (ticket.status === "claimed" && ticket.claimedByAdminId) {
      // Уже в работе у конкретного админа — шлём сразу ему
      await sendViaBot(
        null,
        ticket.claimedByAdminId,
        `✉️ Новое сообщение по тикету #${ticket.id} от ${displayName(username, first_name)} (${id}):\n\n${text}\n\nОтветить: /reply ${ticket.id} <текст>`
      );
      return;
    }

    // Новый (открытый) тикет — уведомляем ВСЕХ админов с кнопкой "Взять в работу"
    const allAdmins = [...FULL_ADMIN_IDS, ...(await getAdminList()).map((a) => a.telegramId)];
    const uniqueAdmins = Array.from(new Set(allAdmins));
    const notified: Record<string, number> = {};

    for (const adminId of uniqueAdmins) {
      try {
        const sentMsg = await bot.telegram.sendMessage(
          adminId,
          `✉️ <b>Новое обращение #${ticket.id}</b>\n\n👤 От: ${displayName(username, first_name)} (${id})\n🤖 Бот: ${isMain ? "главный" : "@" + botUsername}\n\n💬 ${text}`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("🟦 Онлайн — Взять в работу", `ticket_claim_${ticket.id}`)]]),
          }
        );
        notified[String(adminId)] = sentMsg.message_id;
      } catch {
        // админ недоступен
      }
    }
    await setTicketNotifiedMessages(ticket.id, notified);

    await ctx.reply("✅ Ваше сообщение передано администратору. К вам скоро подключится сапорт, пожалуйста ожидайте.");
  });

  bot.on("sticker", async (ctx) => {
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (stateRow?.state !== "await_welcome_sticker") return;
    const data = (stateRow.data ?? {}) as Record<string, unknown>;
    const welcomeText = data.welcomeText as string;
    const stickerId = ctx.message.sticker.file_id;
    await clearUserState(id);
    if (isMain) {
      await setBotSetting("welcome_message", welcomeText);
      await setBotSetting("welcome_sticker_id", stickerId);
    } else if (botId) {
      await setManagedBotWelcome(botId, welcomeText, stickerId);
    }
    await ctx.reply("✅ Приветствие и стикер сохранены!");
  });

  // ─── Inline-кнопки шага "тип товара" и "параметры купона" ──────────────────
  bot.action("product_type_invite_link", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow || stateRow.state !== "admin_add_product_type") return;
    await setUserState(id, "admin_add_product_channel", stateRow.data as Record<string, unknown>);
    await ctx.reply("Введите ID канала/группы для выдачи ссылки.\nНапример: -1001234567890\n\n⚠️ Бот должен быть администратором в этом канале!");
  });

  bot.action("product_type_digital", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow || stateRow.state !== "admin_add_product_type") return;
    await setUserState(id, "admin_add_product_digital", stateRow.data as Record<string, unknown>);
    await ctx.reply("Введите цифровой контент (текст, который получит покупатель):");
  });

  bot.action("coupon_dtype_percent", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow) return;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    data.discountType = "percent";
    await setUserState(id, "admin_add_coupon_discount_value", data);
    await ctx.reply("Шаг 3/5: Введите процент скидки (например: 80):");
  });

  bot.action("coupon_dtype_fixed", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow) return;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    data.discountType = "fixed";
    await setUserState(id, "admin_add_coupon_discount_value", data);
    await ctx.reply("Шаг 3/5: Введите сумму скидки в рублях (например: 500):");
  });

  bot.action("coupon_ltype_activations", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow) return;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    data.limitType = "activations";
    await setUserState(id, "admin_add_coupon_limit_value", data);
    await ctx.reply("Введите лимит активаций (0 = безлимитный):");
  });

  bot.action("coupon_ltype_amount", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow) return;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    data.limitType = "amount";
    await setUserState(id, "admin_add_coupon_limit_value", data);
    await ctx.reply("Введите максимальную суммарную скидку в рублях (например: 10000):");
  });

  bot.action("coupon_ltype_time", async (ctx) => {
    await ctx.answerCbQuery();
    const { id } = ctx.from;
    const stateRow = await getUserState(id);
    if (!stateRow) return;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    data.limitType = "time";
    await setUserState(id, "admin_add_coupon_limit_value", data);
    await ctx.reply("Введите количество дней действия купона (например: 7):");
  });

  bot.catch((err) => {
    console.error("Ошибка в обработчике бота:", err);
  });

  registerBotInstance(botId, bot);
  return bot;
}

// ─── Инициация платежа ──────────────────────────────────────────────────────────
async function initiatePayment(
  ctx: Context,
  productId: number,
  method: "sbp" | "card" | "cryptobot",
  botUsername: string,
  botId: number | null,
  couponCode?: string
) {
  const product = await getProductById(productId);
  if (!product) return;

  const { id: telegramId, username, first_name } = ctx.from!;
  await getOrCreateUser(telegramId, username, first_name, undefined, undefined, botId);

  let baseAmount = parseFloat(product.price);
  let discountPercent = 0;
  let discountAmt = 0;

  if (couponCode) {
    const result = await validateCoupon(couponCode, productId);
    if (result.valid && result.coupon) {
      discountAmt = calcDiscount(result.coupon, baseAmount);
      discountPercent = result.coupon.discountType === "percent" ? result.coupon.discountPercent : 0;
      baseAmount = +(baseAmount - discountAmt).toFixed(2);
    }
  }

  let finalAmount = baseAmount;
  let amountLabel = formatMoney(baseAmount);

  if (method === "sbp" || method === "card") {
    finalAmount = calcAmountWithCommission(baseAmount);
    amountLabel = `${formatMoney(baseAmount)} + 10% = ${formatMoney(finalAmount)}`;
  }

  const order = await createOrder({
    buyerTelegramId: telegramId,
    productId,
    amount: baseAmount,
    paymentMethod: method,
    couponCode,
    discountPercent,
    discountAmount: discountAmt,
    botId: botId ?? undefined,
  });

  if (method === "sbp" || method === "card") {
    const invoice = await createPlategaInvoice(finalAmount, `order_${order.id}`, `Оплата товара: ${product.name}`, method, botUsername);
    if (!invoice || !invoice.paymentUrl) {
      await ctx.replyWithHTML(
        `💳 <b>Оплата через ${method === "sbp" ? "СБП" : "карту"}</b>\n\nТовар: ${product.name}\nСумма к оплате: ${formatMoney(finalAmount)}\n\n⚠️ Способ оплаты пока не настроен администратором. ID заказа: ${order.id}`
      );
      return;
    }

    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(ordersTable).set({ externalPaymentId: invoice.paymentId }).where(eq(ordersTable.id, order.id));

    const emoji = method === "sbp" ? "💳" : "🏦";
    const label = method === "sbp" ? "СБП" : "банковской картой";
    await ctx.replyWithHTML(
      `${emoji} <b>Оплата ${label}</b>\n\n📦 Товар: ${product.name}\n` +
        (couponCode ? `🏷 Купон: ${couponCode} (-${discountAmt > 0 ? formatMoney(discountAmt) : discountPercent + "%"})\n` : "") +
        `💰 Сумма: ${amountLabel}\n\nНажмите кнопку ниже для оплаты:`,
      Markup.inlineKeyboard([[Markup.button.url(`${emoji} Оплатить ${label}`, invoice.paymentUrl)]])
    );
  } else if (method === "cryptobot") {
    const usdRate = await getLiveUsdRate();
    const amountUsdt = rubToUsdt(baseAmount, usdRate);

    const invoice = await createCryptoBotInvoice(amountUsdt, `Оплата товара: ${product.name}`, `order_${order.id}`);
    if (!invoice) {
      await ctx.replyWithHTML(
        `🪙 <b>Оплата CryptoBot</b>\n\nТовар: ${product.name}\nСумма: ${formatMoney(baseAmount)} (≈ ${amountUsdt} USDT)\n\n⚠️ CryptoBot не настроен. ID заказа: ${order.id}`
      );
      return;
    }

    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(ordersTable).set({ externalPaymentId: invoice.invoiceId }).where(eq(ordersTable.id, order.id));

    await ctx.replyWithHTML(
      `🪙 <b>Оплата CryptoBot</b>\n\n📦 Товар: ${product.name}\n` +
        (couponCode ? `🏷 Купон: ${couponCode} (-${discountAmt > 0 ? formatMoney(discountAmt) : discountPercent + "%"})\n` : "") +
        `💰 Сумма: ${formatMoney(baseAmount)}\n💵 Курс (закупочный): ${usdRate} ₽/$\n💎 USDT: ${amountUsdt} USDT\n\nНажмите кнопку для оплаты:`,
      Markup.inlineKeyboard([[Markup.button.url("🪙 Оплатить через CryptoBot", invoice.invoiceUrl)]])
    );
  }

  if (couponCode && discountAmt > 0) {
    await useCoupon(couponCode, discountAmt);
  }
}

// ─── Выдача товара после оплаты ──────────────────────────────────────────────────
export async function deliverOrder(ctx: Context, orderId: number, buyerTelegramId: number) {
  const { db } = await import("@/db");
  const { orders: ordersTable } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const orderRows = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  const order = orderRows[0];

  if (!order) return ctx.reply(`❌ Заказ #${orderId} не найден.`);
  if (order.status === "paid") return ctx.reply(`ℹ️ Заказ #${orderId} уже выполнен.`);

  const product = await getProductById(order.productId);
  if (!product) return ctx.reply(`❌ Товар не найден.`);

  let deliveredContent = "";

  if (product.productType === "invite_link" && product.channelId) {
    try {
      const inviteLink = await ctx.telegram.createChatInviteLink(product.channelId, { creates_join_request: false, member_limit: 1 });
      deliveredContent = inviteLink.invite_link;
    } catch (e) {
      console.error("Ошибка создания ссылки:", e);
      deliveredContent = "❌ Не удалось создать ссылку. Обратитесь к администратору.";
    }
  } else if (product.productType === "digital" && product.digitalContent) {
    deliveredContent = product.digitalContent;
  }

  await markOrderPaidSafe(orderId, deliveredContent);
  const purchaseResult = await recordPurchase(buyerTelegramId, parseFloat(order.amount), product.name);

  try {
    if (product.productType === "invite_link") {
      await ctx.telegram.sendMessage(
        buyerTelegramId,
        `✅ Оплата подтверждена!\n\n📦 Товар: ${product.name}\n\n🔗 Ваша одноразовая ссылка:\n${deliveredContent}\n\n⚠️ Ссылка одноразовая — не передавайте её!`
      );
    } else {
      await ctx.telegram.sendMessage(buyerTelegramId, `✅ Оплата подтверждена!\n\n📦 Товар: ${product.name}\n\n📋 Ваш контент:\n${deliveredContent}`);
    }
  } catch (e) {
    console.error("Ошибка отправки товара:", e);
  }

  await ctx.reply(`✅ Заказ #${orderId} выполнен.\nПользователю ${buyerTelegramId} отправлен товар «${product.name}».`);

  const buyer = await getUserByTelegramId(buyerTelegramId);
  if (buyer?.referredBy) {
    const commission = purchaseResult.commission;
    const commPct = purchaseResult.commissionPercent;
    try {
      await ctx.telegram.sendMessage(
        buyer.referredBy,
        `🎉 Реферальная комиссия!\n\nВаш реферал ${displayName(buyer.username, buyer.firstName)} купил «${product.name}».\n💰 Ваша комиссия (${commPct}%): ${formatMoney(commission)}\n\n/balance — ваш баланс\n/mystats — ваша статистика`
      );
    } catch {
      // реферер недоступен
    }
  }
}

async function markOrderPaidSafe(orderId: number, deliveredLink?: string) {
  const { markOrderPaid } = await import("./helpers");
  await markOrderPaid(orderId, deliveredLink);
}
