import { db } from "@/db";
import {
  users,
  referralLinks,
  purchases,
  earnings,
  botLogs,
  orders,
  products,
  userStates,
  coupons,
  botSettings,
  referralBalances,
  withdrawalRequests,
  admins,
  managedBots,
  supportTickets,
  supportMessages,
} from "@/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";

// ─── Пользователи ─────────────────────────────────────────────────────────────
export async function getOrCreateUser(
  telegramId: number,
  username?: string,
  firstName?: string,
  lastName?: string,
  referralCode?: string,
  originBotId?: number | null
) {
  const existing = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  if (existing.length > 0) {
    await db.update(users).set({ username, firstName, lastName }).where(eq(users.telegramId, telegramId));
    return existing[0];
  }

  let referredBy: number | undefined;
  let referralType: string | undefined;

  if (referralCode) {
    const link = await db.select().from(referralLinks).where(eq(referralLinks.code, referralCode)).limit(1);
    if (link.length > 0 && link[0].ownerId !== telegramId) {
      referredBy = link[0].ownerId;
      referralType = "link";
      await db
        .update(referralLinks)
        .set({ referredCount: sql`${referralLinks.referredCount} + 1` })
        .where(eq(referralLinks.code, referralCode));
    }
  } else if (originBotId) {
    // Пользователь запустил бота, созданного другим пользователем — это тоже
    // считается рефералом (тип "bot"), но не суммируется с обычными реф.кодами.
    const botRow = await getManagedBotById(originBotId);
    if (botRow && botRow.ownerTelegramId !== telegramId) {
      referredBy = botRow.ownerTelegramId;
      referralType = "bot";
    }
  }

  const [newUser] = await db
    .insert(users)
    .values({ telegramId, username, firstName, lastName, referredBy, referralType, originBotId: originBotId ?? null })
    .returning();

  const code = username ?? `user${telegramId}`;
  const existingCode = await db.select().from(referralLinks).where(eq(referralLinks.code, code)).limit(1);

  if (existingCode.length === 0) {
    await db.insert(referralLinks).values({ ownerId: telegramId, ownerUsername: username, code });
  }

  await ensureEarningsRow(telegramId, username, firstName);
  await ensureReferralBalanceRow(telegramId, username, firstName);
  await logAction(telegramId, username, "JOIN", referredBy ? `via ${referralType}:${referralCode ?? originBotId}` : "organic");

  return newUser;
}

export async function getUserByTelegramId(telegramId: number) {
  const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

// ─── Реферальные ссылки ───────────────────────────────────────────────────────
export async function getReferralLink(telegramId: number) {
  const rows = await db.select().from(referralLinks).where(eq(referralLinks.ownerId, telegramId)).limit(1);
  return rows[0] ?? null;
}

export async function getAllReferralLinksWithStats() {
  return db.select().from(referralLinks).orderBy(desc(referralLinks.referredCount));
}

export async function incrementLinkClick(code: string) {
  await db
    .update(referralLinks)
    .set({ clickCount: sql`${referralLinks.clickCount} + 1` })
    .where(eq(referralLinks.code, code));
}

export async function getReferralBreakdown(telegramId: number) {
  const [linkRefs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.referredBy, telegramId), eq(users.referralType, "link")));
  const [botRefs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.referredBy, telegramId), eq(users.referralType, "bot")));
  return { linkRefs: linkRefs.count, botRefs: botRefs.count };
}

// ─── Товары ───────────────────────────────────────────────────────────────────
export async function getActiveProducts() {
  return db.select().from(products).where(eq(products.isActive, true)).orderBy(products.id);
}

export async function getAllProductsAdmin() {
  return db.select().from(products).orderBy(products.id);
}

export async function getProductById(id: number) {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProduct(data: {
  name: string;
  description?: string | null;
  price: number;
  productType: string;
  channelId?: string;
  digitalContent?: string;
}) {
  const [p] = await db
    .insert(products)
    .values({
      name: data.name,
      description: data.description ?? null,
      price: data.price.toString(),
      productType: data.productType,
      channelId: data.channelId,
      digitalContent: data.digitalContent,
    })
    .returning();
  return p;
}

export async function updateProduct(id: number, data: Record<string, unknown>) {
  await db.update(products).set(data).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  await db.update(products).set({ isActive: false }).where(eq(products.id, id));
}

// ─── Купоны ───────────────────────────────────────────────────────────────────
export async function getCouponByCode(code: string) {
  const rows = await db.select().from(coupons).where(eq(coupons.code, code.toUpperCase())).limit(1);
  return rows[0] ?? null;
}

export async function validateCoupon(
  code: string,
  productId?: number
): Promise<{ valid: boolean; error?: string; coupon?: typeof coupons.$inferSelect }> {
  const coupon = await getCouponByCode(code);
  if (!coupon) return { valid: false, error: "Купон не найден" };
  if (!coupon.isActive) return { valid: false, error: "Купон деактивирован" };
  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    return { valid: false, error: "Купон истёк" };
  }

  if (coupon.limitType === "activations") {
    if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
      return { valid: false, error: "Купон исчерпан (лимит активаций)" };
    }
  } else if (coupon.limitType === "time") {
    if (!coupon.expiresAt) return { valid: false, error: "Купон без срока действия" };
    if (new Date() > coupon.expiresAt) return { valid: false, error: "Купон истёк по времени" };
  } else if (coupon.limitType === "amount") {
    const maxAmt = parseFloat(coupon.maxDiscountAmount.toString());
    const usedAmt = parseFloat(coupon.totalDiscountUsed.toString());
    if (maxAmt > 0 && usedAmt >= maxAmt) return { valid: false, error: "Купон исчерпан (лимит суммы)" };
  }

  if (productId && coupon.productIds) {
    const allowedIds = coupon.productIds as number[];
    if (allowedIds.length > 0 && !allowedIds.includes(productId)) {
      return { valid: false, error: "Купон не применяется к данному товару" };
    }
  }

  return { valid: true, coupon };
}

export async function useCoupon(code: string, discountAmount = 0) {
  await db
    .update(coupons)
    .set({
      usageCount: sql`${coupons.usageCount} + 1`,
      totalDiscountUsed: sql`${coupons.totalDiscountUsed} + ${discountAmount}`,
    })
    .where(eq(coupons.code, code.toUpperCase()));
}

export async function createCoupon(data: {
  code: string;
  discountType?: string;
  discountPercent?: number;
  discountFixed?: number;
  limitType?: string;
  usageLimit?: number;
  maxDiscountAmount?: number;
  productIds?: number[];
  expiresAt?: Date;
}) {
  const [c] = await db
    .insert(coupons)
    .values({
      code: data.code.toUpperCase(),
      discountType: data.discountType ?? "percent",
      discountPercent: data.discountPercent ?? 0,
      discountFixed: (data.discountFixed ?? 0).toString(),
      limitType: data.limitType ?? "activations",
      usageLimit: data.usageLimit ?? 0,
      maxDiscountAmount: (data.maxDiscountAmount ?? 0).toString(),
      productIds: data.productIds ?? null,
      expiresAt: data.expiresAt,
    })
    .returning();
  return c;
}

export async function getAllCoupons() {
  return db.select().from(coupons).orderBy(desc(coupons.createdAt));
}

export async function deactivateCoupon(id: number) {
  await db.update(coupons).set({ isActive: false }).where(eq(coupons.id, id));
}

export function calcDiscount(coupon: typeof coupons.$inferSelect, baseAmount: number): number {
  if (coupon.discountType === "fixed") {
    const fixed = parseFloat(coupon.discountFixed.toString());
    return Math.min(fixed, baseAmount);
  }
  return +(baseAmount * (coupon.discountPercent / 100)).toFixed(2);
}

// ─── Заказы ───────────────────────────────────────────────────────────────────
export async function createOrder(data: {
  buyerTelegramId: number;
  productId: number;
  amount: number;
  paymentMethod: string;
  externalPaymentId?: string;
  couponCode?: string;
  discountPercent?: number;
  discountAmount?: number;
  botId?: number | null;
}) {
  const buyer = await getUserByTelegramId(data.buyerTelegramId);
  const referrerTelegramId = buyer?.referredBy ?? null;
  const commission = +(data.amount * 0.1).toFixed(2);

  const [order] = await db
    .insert(orders)
    .values({
      buyerTelegramId: data.buyerTelegramId,
      referrerTelegramId,
      productId: data.productId,
      amount: data.amount.toString(),
      commission: commission.toString(),
      paymentMethod: data.paymentMethod,
      status: "pending",
      externalPaymentId: data.externalPaymentId,
      couponCode: data.couponCode,
      discountPercent: data.discountPercent ?? 0,
      discountAmount: (data.discountAmount ?? 0).toString(),
      botId: data.botId ?? null,
    })
    .returning();
  return order;
}

export async function getOrderByExternalId(externalId: string) {
  const rows = await db.select().from(orders).where(eq(orders.externalPaymentId, externalId)).limit(1);
  return rows[0] ?? null;
}

export async function getOrderById(id: number) {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markOrderPaid(orderId: number, deliveredLink?: string) {
  await db
    .update(orders)
    .set({ status: "paid", paidAt: new Date(), deliveredLink: deliveredLink ?? null })
    .where(eq(orders.id, orderId));
}

export async function getRecentOrders(limit = 20) {
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
}

// ─── Покупки (реферальная система) ────────────────────────────────────────────
export async function recordPurchase(
  buyerTelegramId: number,
  amount: number,
  description?: string
): Promise<{ commission: number; commissionPercent: number }> {
  const buyer = await getUserByTelegramId(buyerTelegramId);
  const referrerTelegramId = buyer?.referredBy ?? null;

  let commissionPercent = 40;
  let commission = 0;

  if (referrerTelegramId) {
    await ensureReferralBalanceRow(referrerTelegramId);
    const refBalance = await getReferralBalance(referrerTelegramId);
    const totalRefPurchases = parseFloat(refBalance?.totalRefPurchases?.toString() ?? "0");
    commissionPercent = calcDynamicCommissionPercent(totalRefPurchases);
    commission = +(amount * (commissionPercent / 100)).toFixed(2);
  }

  await db.insert(purchases).values({
    buyerTelegramId,
    referrerTelegramId,
    amount: amount.toString(),
    commission: commission.toString(),
    description,
  });

  if (referrerTelegramId && commission > 0) {
    await db
      .insert(earnings)
      .values({ telegramId: referrerTelegramId, totalEarned: commission.toString() })
      .onConflictDoUpdate({
        target: earnings.telegramId,
        set: { totalEarned: sql`${earnings.totalEarned} + ${commission}`, updatedAt: new Date() },
      });

    const newTotalRefPurchases =
      parseFloat((await getReferralBalance(referrerTelegramId))?.totalRefPurchases?.toString() ?? "0") + amount;
    const newCommissionPercent = calcDynamicCommissionPercent(newTotalRefPurchases);

    await db
      .update(referralBalances)
      .set({
        balanceRub: sql`${referralBalances.balanceRub} + ${commission}`,
        totalRefPurchases: sql`${referralBalances.totalRefPurchases} + ${amount}`,
        commissionPercent: newCommissionPercent.toString(),
        updatedAt: new Date(),
      })
      .where(eq(referralBalances.telegramId, referrerTelegramId));
  }

  return { commission, commissionPercent };
}

export async function getRecentPurchases(limit = 20) {
  return db.select().from(purchases).orderBy(desc(purchases.createdAt)).limit(limit);
}

// ─── Динамический процент комиссии ────────────────────────────────────────────
export function calcDynamicCommissionPercent(totalRefPurchases: number): number {
  const BASE_THRESHOLD = 5000;
  const BASE_PERCENT = 40;
  const BOOST_PERCENT = 50;
  const PER_1000 = 1000;

  if (totalRefPurchases < BASE_THRESHOLD) return BASE_PERCENT;
  const extra = Math.floor((totalRefPurchases - BASE_THRESHOLD) / PER_1000);
  return BOOST_PERCENT + extra;
}

// ─── Баланс рефералов ─────────────────────────────────────────────────────────
export async function ensureReferralBalanceRow(telegramId: number, username?: string, firstName?: string) {
  await db
    .insert(referralBalances)
    .values({ telegramId, username, firstName })
    .onConflictDoUpdate({ target: referralBalances.telegramId, set: { username, firstName } });
}

export async function getReferralBalance(telegramId: number) {
  const rows = await db.select().from(referralBalances).where(eq(referralBalances.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

export async function getUserLeaderboardRank(telegramId: number): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*) + 1 as rank FROM referral_balances WHERE total_ref_purchases > (
      SELECT COALESCE(total_ref_purchases, 0) FROM referral_balances WHERE telegram_id = ${telegramId}
    )`
  );
  const row = result.rows[0] as { rank: string };
  return parseInt(row?.rank ?? "1");
}

export async function getTopByRefPurchases(limit = 5) {
  return db.select().from(referralBalances).orderBy(desc(referralBalances.totalRefPurchases)).limit(limit);
}

export async function getTopEarners(limit = 5) {
  return db.select().from(earnings).orderBy(desc(earnings.totalEarned)).limit(limit);
}

export async function getEarningsByTelegramId(telegramId: number) {
  const rows = await db.select().from(earnings).where(eq(earnings.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

// ─── Заявки на вывод ──────────────────────────────────────────────────────────
export async function createWithdrawalRequest(data: {
  telegramId: number;
  username?: string;
  firstName?: string;
  amountRub: number;
  amountUsdt: number;
  rateUsed: number;
}): Promise<{ success: boolean; error?: string; request?: typeof withdrawalRequests.$inferSelect }> {
  const pendingRows = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.telegramId, data.telegramId), eq(withdrawalRequests.status, "pending")))
    .limit(1);

  if (pendingRows.length > 0) return { success: false, error: "У вас уже есть активная заявка на вывод" };

  const balance = await getReferralBalance(data.telegramId);
  const currentBalance = parseFloat(balance?.balanceRub?.toString() ?? "0");
  if (currentBalance < data.amountRub) return { success: false, error: "Недостаточно средств на балансе" };
  if (data.amountRub < 100) return { success: false, error: "Минимальная сумма вывода: 100 ₽" };

  await db
    .update(referralBalances)
    .set({ balanceRub: sql`${referralBalances.balanceRub} - ${data.amountRub}`, updatedAt: new Date() })
    .where(eq(referralBalances.telegramId, data.telegramId));

  const [request] = await db
    .insert(withdrawalRequests)
    .values({
      telegramId: data.telegramId,
      username: data.username,
      firstName: data.firstName,
      amountRub: data.amountRub.toString(),
      amountUsdt: data.amountUsdt.toString(),
      rateUsed: data.rateUsed.toString(),
      status: "pending",
    })
    .returning();

  return { success: true, request };
}

export async function getPendingWithdrawals() {
  return db.select().from(withdrawalRequests).where(eq(withdrawalRequests.status, "pending")).orderBy(withdrawalRequests.createdAt);
}

export async function getAllWithdrawals(limit = 50) {
  return db.select().from(withdrawalRequests).orderBy(desc(withdrawalRequests.createdAt)).limit(limit);
}

export async function getUserWithdrawals(telegramId: number) {
  return db.select().from(withdrawalRequests).where(eq(withdrawalRequests.telegramId, telegramId)).orderBy(desc(withdrawalRequests.createdAt));
}

export async function processWithdrawal(
  id: number,
  status: "processing" | "paid" | "rejected",
  cryptoCheckToken?: string,
  adminNote?: string
) {
  const [req] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)).limit(1);
  if (!req) return null;

  await db
    .update(withdrawalRequests)
    .set({
      status,
      cryptoCheckToken: cryptoCheckToken ?? req.cryptoCheckToken,
      adminNote: adminNote ?? req.adminNote,
      updatedAt: new Date(),
    })
    .where(eq(withdrawalRequests.id, id));

  if (status === "paid") {
    const amountRub = parseFloat(req.amountRub.toString());
    await db
      .update(referralBalances)
      .set({ totalWithdrawn: sql`${referralBalances.totalWithdrawn} + ${amountRub}`, updatedAt: new Date() })
      .where(eq(referralBalances.telegramId, req.telegramId));
  }

  if (status === "rejected") {
    const amountRub = parseFloat(req.amountRub.toString());
    await db
      .update(referralBalances)
      .set({ balanceRub: sql`${referralBalances.balanceRub} + ${amountRub}`, updatedAt: new Date() })
      .where(eq(referralBalances.telegramId, req.telegramId));
  }

  return req;
}

// ─── Статистика ───────────────────────────────────────────────────────────────
export async function getTotalStats() {
  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const [linkCount] = await db.select({ count: sql<number>`count(*)::int` }).from(referralLinks);
  const [purchaseStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(amount),0)::text`,
      commissions: sql<string>`coalesce(sum(commission),0)::text`,
    })
    .from(purchases);
  const [orderStats] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(amount),0)::text` })
    .from(orders)
    .where(eq(orders.status, "paid"));
  const [earningsStats] = await db.select({ total: sql<string>`coalesce(sum(total_earned),0)::text` }).from(earnings);
  const [pendingWithdrawals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.status, "pending"));
  const [botsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(managedBots).where(eq(managedBots.isActive, true));
  const [openTickets] = await db.select({ count: sql<number>`count(*)::int` }).from(supportTickets).where(eq(supportTickets.status, "open"));

  return {
    users: userCount.count,
    links: linkCount.count,
    purchases: purchaseStats.count,
    totalRevenue: purchaseStats.total,
    totalCommissions: purchaseStats.commissions,
    totalPaidOut: earningsStats.total,
    paidOrders: orderStats.count,
    ordersRevenue: orderStats.total,
    pendingWithdrawals: pendingWithdrawals.count,
    activeBots: botsCount.count,
    openTickets: openTickets.count,
  };
}

export async function getAllUsers() {
  return db.select().from(users).orderBy(desc(users.joinedAt));
}

export async function getUserDetailedStats(telegramId: number) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;

  const link = await getReferralLink(telegramId);
  const earned = await getEarningsByTelegramId(telegramId);
  const balance = await getReferralBalance(telegramId);
  const breakdown = await getReferralBreakdown(telegramId);

  const [refPurchaseStats] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(amount),0)::text` })
    .from(purchases)
    .where(eq(purchases.referrerTelegramId, telegramId));

  const [ownPurchaseStats] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(amount),0)::text` })
    .from(purchases)
    .where(eq(purchases.buyerTelegramId, telegramId));

  const [ownOrderStats] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(amount),0)::text` })
    .from(orders)
    .where(and(eq(orders.buyerTelegramId, telegramId), eq(orders.status, "paid")));

  const rank = await getUserLeaderboardRank(telegramId);
  const commissionPercent = calcDynamicCommissionPercent(parseFloat(balance?.totalRefPurchases?.toString() ?? "0"));

  return {
    user,
    link,
    totalEarned: earned?.totalEarned ?? "0",
    refPurchases: refPurchaseStats.count,
    refRevenue: refPurchaseStats.total,
    ownPurchases: ownPurchaseStats.count,
    ownSpent: ownPurchaseStats.total,
    ownOrders: ownOrderStats.count,
    ownOrdersTotal: ownOrderStats.total,
    balance: balance?.balanceRub ?? "0",
    totalRefPurchases: balance?.totalRefPurchases ?? "0",
    totalWithdrawn: balance?.totalWithdrawn ?? "0",
    commissionPercent,
    rank,
    breakdown,
  };
}

export async function getPublicProfile(telegramId: number) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;

  const link = await getReferralLink(telegramId);
  const balance = await getReferralBalance(telegramId);
  const breakdown = await getReferralBreakdown(telegramId);

  const [refPurchaseStats] = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(amount),0)::text` })
    .from(purchases)
    .where(eq(purchases.referrerTelegramId, telegramId));

  const [uniqueBuyers] = await db
    .select({ count: sql<number>`count(distinct buyer_telegram_id)::int` })
    .from(purchases)
    .where(eq(purchases.referrerTelegramId, telegramId));

  const rank = await getUserLeaderboardRank(telegramId);
  const totalRefPurchases = parseFloat(balance?.totalRefPurchases?.toString() ?? "0");
  const commissionPercent = calcDynamicCommissionPercent(totalRefPurchases);

  let nextThreshold = 5000;
  let nextPercent = 50;
  if (totalRefPurchases >= 5000) {
    const step = Math.floor((totalRefPurchases - 5000) / 1000);
    nextThreshold = 5000 + (step + 1) * 1000;
    nextPercent = 50 + step + 1;
  }

  return {
    telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    joinedAt: user.joinedAt,
    referralCode: link?.code ?? null,
    clickCount: link?.clickCount ?? 0,
    referredCount: link?.referredCount ?? 0,
    refPurchasesCount: refPurchaseStats.count,
    refRevenue: refPurchaseStats.total,
    uniqueBuyers: uniqueBuyers.count,
    commissionPercent,
    nextThreshold,
    nextPercent,
    totalRefPurchases,
    rank,
    breakdown,
  };
}

// ─── FSM (состояния диалогов) ─────────────────────────────────────────────────
export async function getUserState(telegramId: number) {
  const rows = await db.select().from(userStates).where(eq(userStates.telegramId, telegramId)).limit(1);
  return rows[0] ?? null;
}

export async function setUserState(telegramId: number, state: string, data?: Record<string, unknown>) {
  await db
    .insert(userStates)
    .values({ telegramId, state, data: data ?? {}, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userStates.telegramId, set: { state, data: data ?? {}, updatedAt: new Date() } });
}

export async function clearUserState(telegramId: number) {
  await db.delete(userStates).where(eq(userStates.telegramId, telegramId));
}

// ─── Настройки бота ───────────────────────────────────────────────────────────
export async function getBotSetting(key: string, defaultValue = "") {
  const rows = await db.select().from(botSettings).where(eq(botSettings.key, key)).limit(1);
  return rows[0]?.value ?? defaultValue;
}

export async function setBotSetting(key: string, value: string) {
  await db
    .insert(botSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: botSettings.key, set: { value, updatedAt: new Date() } });
}

// ─── Вспомогательные ──────────────────────────────────────────────────────────
export async function ensureEarningsRow(telegramId: number, username?: string, firstName?: string) {
  await db
    .insert(earnings)
    .values({ telegramId, username, firstName, totalEarned: "0" })
    .onConflictDoUpdate({ target: earnings.telegramId, set: { username, firstName } });
}

export async function logAction(telegramId: number | null, username: string | undefined, action: string, detail?: string) {
  await db.insert(botLogs).values({ telegramId, username, action, detail });
}

export function formatMoney(val: string | number | null | undefined): string {
  const n = parseFloat(String(val ?? "0"));
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}

export function displayName(username?: string | null, firstName?: string | null): string {
  if (username) return `@${username}`;
  if (firstName) return firstName;
  return "Неизвестный";
}

// ─── Курс USD→RUB ─────────────────────────────────────────────────────────────
export function getPurchaseRate(officialRate: number): number {
  return Math.floor(officialRate) - 2;
}

export function roundUsdRate(rawRate: number): number {
  return getPurchaseRate(rawRate);
}

export function rubToUsdt(amountRub: number, usdRubRate: number): number {
  if (usdRubRate <= 0) return 0;
  return +(amountRub / usdRubRate).toFixed(2);
}

// ─── Stars ────────────────────────────────────────────────────────────────────
export function calcStarsByUsername(amountRub: number, fragmentRateRubPerStar: number): number {
  const starsRaw = amountRub / fragmentRateRubPerStar;
  const starsWithFee = starsRaw * 1.07;
  return Math.floor(starsWithFee / 50) * 50;
}

export function calcStarsByGift(amountRub: number, fragmentRateRubPerStar: number): number {
  const starsRaw = amountRub / fragmentRateRubPerStar;
  const starsWithFees = starsRaw * (1 / (0.93 * 0.7));
  return Math.floor(starsWithFees / 50) * 50;
}

export function calcAmountWithCommission(baseAmount: number): number {
  return +(baseAmount * 1.1).toFixed(2);
}

export function getPurchaseRateStars(): number {
  return parseFloat(process.env.FRAGMENT_RATE_RUB ?? "1.12");
}

// ─── Обычные админы поддержки ──────────────────────────────────────────────────
export async function getAdminList() {
  return db.select().from(admins).orderBy(desc(admins.createdAt));
}

export async function isAdminInDb(telegramId: number): Promise<boolean> {
  const rows = await db.select().from(admins).where(eq(admins.telegramId, telegramId)).limit(1);
  return rows.length > 0;
}

export async function addAdminToDb(telegramId: number, username: string | undefined, addedBy: number) {
  const [row] = await db
    .insert(admins)
    .values({ telegramId, username, addedBy })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function removeAdminFromDb(telegramId: number) {
  await db.delete(admins).where(eq(admins.telegramId, telegramId));
}

// ─── Управляемые (созданные пользователями) боты ──────────────────────────────
export async function createManagedBot(data: {
  ownerTelegramId: number;
  ownerUsername?: string;
  token: string;
  botUsername: string;
  botFirstName?: string;
}) {
  const [row] = await db
    .insert(managedBots)
    .values({
      ownerTelegramId: data.ownerTelegramId,
      ownerUsername: data.ownerUsername,
      token: data.token,
      botUsername: data.botUsername,
      botFirstName: data.botFirstName,
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function getActiveManagedBots() {
  return db.select().from(managedBots).where(eq(managedBots.isActive, true)).orderBy(managedBots.createdAt);
}

export async function getAllManagedBots() {
  return db.select().from(managedBots).orderBy(desc(managedBots.createdAt));
}

export async function getManagedBotById(id: number) {
  const rows = await db.select().from(managedBots).where(eq(managedBots.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getManagedBotsByOwner(ownerTelegramId: number) {
  return db.select().from(managedBots).where(eq(managedBots.ownerTelegramId, ownerTelegramId)).orderBy(desc(managedBots.createdAt));
}

export async function deactivateManagedBot(id: number) {
  await db.update(managedBots).set({ isActive: false }).where(eq(managedBots.id, id));
}

export async function setManagedBotWelcome(id: number, welcomeMessage: string | null, welcomeStickerId: string | null) {
  await db.update(managedBots).set({ welcomeMessage, welcomeStickerId }).where(eq(managedBots.id, id));
}

// ─── Тикеты поддержки ──────────────────────────────────────────────────────────
export async function createSupportTicket(data: {
  botId: number | null;
  botUsername?: string;
  fromTelegramId: number;
  fromUsername?: string;
  fromFirstName?: string;
}) {
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      botId: data.botId,
      botUsername: data.botUsername,
      fromTelegramId: data.fromTelegramId,
      fromUsername: data.fromUsername,
      fromFirstName: data.fromFirstName,
      status: "open",
    })
    .returning();
  return ticket;
}

export async function getOpenTicketForUser(fromTelegramId: number, botId: number | null) {
  const rows = await db
    .select()
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.fromTelegramId, fromTelegramId),
        eq(supportTickets.botId, botId ?? -1),
        sql`${supportTickets.status} != 'closed'`
      )
    )
    .orderBy(desc(supportTickets.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTicketById(id: number) {
  const rows = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function claimTicket(id: number, adminId: number, adminUsername?: string) {
  const result = await db
    .update(supportTickets)
    .set({ status: "claimed", claimedByAdminId: adminId, claimedByUsername: adminUsername, updatedAt: new Date() })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.status, "open")))
    .returning();
  return result[0] ?? null;
}

export async function closeTicket(id: number) {
  await db.update(supportTickets).set({ status: "closed", updatedAt: new Date() }).where(eq(supportTickets.id, id));
}

export async function setTicketNotifiedMessages(id: number, notifiedMessages: Record<string, number>) {
  await db.update(supportTickets).set({ notifiedMessages }).where(eq(supportTickets.id, id));
}

export async function getOpenTickets() {
  return db.select().from(supportTickets).where(sql`${supportTickets.status} != 'closed'`).orderBy(desc(supportTickets.createdAt));
}

export async function getAllTickets(limit = 50) {
  return db.select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(limit);
}

export async function addSupportMessage(data: {
  ticketId: number;
  senderTelegramId: number;
  senderRole: "user" | "admin";
  senderUsername?: string;
  text: string;
}) {
  const [msg] = await db
    .insert(supportMessages)
    .values({
      ticketId: data.ticketId,
      senderTelegramId: data.senderTelegramId,
      senderRole: data.senderRole,
      senderUsername: data.senderUsername,
      text: data.text,
    })
    .returning();
  return msg;
}

export async function getTicketMessages(ticketId: number) {
  return db.select().from(supportMessages).where(eq(supportMessages.ticketId, ticketId)).orderBy(supportMessages.createdAt);
}
