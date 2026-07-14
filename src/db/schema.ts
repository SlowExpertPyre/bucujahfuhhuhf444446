import {
  pgTable,
  serial,
  text,
  bigint,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Пользователи Telegram ─────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    referredBy: bigint("referred_by", { mode: "number" }),
    // "link" — пришёл по обычной реф. ссылке, "bot" — пришёл через созданного реф-бота
    referralType: text("referral_type"),
    // ID бота (managed_bots.id), через который пользователь впервые запустил /start
    originBotId: integer("origin_bot_id"),
    isAdmin: boolean("is_admin").default(false).notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [index("users_telegram_id_idx").on(t.telegramId)]
);

// ─── Реферальные ссылки ────────────────────────────────────────────────────────
export const referralLinks = pgTable(
  "referral_links",
  {
    id: serial("id").primaryKey(),
    ownerId: bigint("owner_id", { mode: "number" }).notNull(),
    ownerUsername: text("owner_username"),
    code: text("code").notNull().unique(),
    clickCount: integer("click_count").default(0).notNull(),
    referredCount: integer("referred_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("referral_links_owner_idx").on(t.ownerId),
    index("referral_links_code_idx").on(t.code),
  ]
);

// ─── Товары магазина ──────────────────────────────────────────────────────────
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  // "invite_link" | "digital"
  productType: text("product_type").default("invite_link").notNull(),
  channelId: text("channel_id"),
  digitalContent: text("digital_content"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Купоны / скидки ──────────────────────────────────────────────────────────
export const coupons = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    discountType: text("discount_type").default("percent").notNull(),
    discountPercent: integer("discount_percent").default(0).notNull(),
    discountFixed: numeric("discount_fixed", { precision: 12, scale: 2 }).default("0").notNull(),
    limitType: text("limit_type").default("activations").notNull(),
    usageLimit: integer("usage_limit").default(0).notNull(),
    usageCount: integer("usage_count").default(0).notNull(),
    maxDiscountAmount: numeric("max_discount_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    totalDiscountUsed: numeric("total_discount_used", { precision: 12, scale: 2 }).default("0").notNull(),
    productIds: jsonb("product_ids"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [index("coupons_code_idx").on(t.code)]
);

// ─── Заказы / оплаты ──────────────────────────────────────────────────────────
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    buyerTelegramId: bigint("buyer_telegram_id", { mode: "number" }).notNull(),
    referrerTelegramId: bigint("referrer_telegram_id", { mode: "number" }),
    productId: integer("product_id").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    commission: numeric("commission", { precision: 12, scale: 2 }).notNull(),
    couponCode: text("coupon_code"),
    discountPercent: integer("discount_percent").default(0).notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0").notNull(),
    paymentMethod: text("payment_method").notNull(),
    status: text("status").default("pending").notNull(),
    externalPaymentId: text("external_payment_id"),
    paymentData: jsonb("payment_data"),
    deliveredLink: text("delivered_link"),
    botId: integer("bot_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
  },
  (t) => [
    index("orders_buyer_idx").on(t.buyerTelegramId),
    index("orders_status_idx").on(t.status),
    index("orders_external_id_idx").on(t.externalPaymentId),
  ]
);

// ─── Покупки (реферальная система) ────────────────────────────────────────────
export const purchases = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    buyerTelegramId: bigint("buyer_telegram_id", { mode: "number" }).notNull(),
    referrerTelegramId: bigint("referrer_telegram_id", { mode: "number" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    commission: numeric("commission", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("purchases_buyer_idx").on(t.buyerTelegramId),
    index("purchases_referrer_idx").on(t.referrerTelegramId),
  ]
);

// ─── Начисления (лидерборд) ───────────────────────────────────────────────────
export const earnings = pgTable(
  "earnings",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    totalEarned: numeric("total_earned", { precision: 12, scale: 2 }).default("0").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("earnings_telegram_id_idx").on(t.telegramId),
    index("earnings_total_earned_idx").on(t.totalEarned),
  ]
);

// ─── Баланс рефералов ─────────────────────────────────────────────────────────
export const referralBalances = pgTable(
  "referral_balances",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    balanceRub: numeric("balance_rub", { precision: 12, scale: 2 }).default("0").notNull(),
    totalRefPurchases: numeric("total_ref_purchases", { precision: 12, scale: 2 }).default("0").notNull(),
    commissionPercent: numeric("commission_percent", { precision: 5, scale: 2 }).default("40").notNull(),
    totalWithdrawn: numeric("total_withdrawn", { precision: 12, scale: 2 }).default("0").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ref_balances_telegram_id_idx").on(t.telegramId)]
);

// ─── Заявки на вывод ──────────────────────────────────────────────────────────
export const withdrawalRequests = pgTable(
  "withdrawal_requests",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    username: text("username"),
    firstName: text("first_name"),
    amountRub: numeric("amount_rub", { precision: 12, scale: 2 }).notNull(),
    amountUsdt: numeric("amount_usdt", { precision: 12, scale: 4 }).notNull(),
    rateUsed: numeric("rate_used", { precision: 8, scale: 2 }).notNull(),
    status: text("status").default("pending").notNull(),
    cryptoCheckToken: text("crypto_check_token"),
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("withdrawal_requests_telegram_id_idx").on(t.telegramId),
    index("withdrawal_requests_status_idx").on(t.status),
  ]
);

// ─── Логи действий ────────────────────────────────────────────────────────────
export const botLogs = pgTable(
  "bot_logs",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }),
    username: text("username"),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("bot_logs_telegram_id_idx").on(t.telegramId)]
);

// ─── Состояния FSM (диалоги) ───────────────────────────────────────────────────
export const userStates = pgTable("user_states", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  state: text("state").notNull(),
  data: jsonb("data").default({}).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Настройки бота (общие, ключ-значение) ────────────────────────────────────
export const botSettings = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Обычные админы (поддержка) ────────────────────────────────────────────────
// Главный админ (OWNER_TELEGRAM_ID) задаётся через .env и не хранится тут —
// его нельзя удалить. Эта таблица — админы, добавленные владельцем через /addadmin.
// Они могут только отвечать пользователям (support-тикеты), но не управляют
// товарами/купонами/выводами/ботами.
export const admins = pgTable(
  "admins",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    addedBy: bigint("added_by", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("admins_telegram_id_idx").on(t.telegramId)]
);
export type AdminRow = typeof admins.$inferSelect;

// ─── Реф-боты, созданные пользователями через основного бота ──────────────────
// Любой пользователь может создать свой бот (передав токен от @BotFather).
// Такой бот работает как полноценная копия основного бота (магазин, рефералка),
// а все саппорт-обращения из него всё равно обрабатывают админы главного бота.
export const managedBots = pgTable(
  "managed_bots",
  {
    id: serial("id").primaryKey(),
    ownerTelegramId: bigint("owner_telegram_id", { mode: "number" }).notNull(),
    ownerUsername: text("owner_username"),
    token: text("token").notNull().unique(),
    botUsername: text("bot_username").notNull(),
    botFirstName: text("bot_first_name"),
    welcomeMessage: text("welcome_message"),
    welcomeStickerId: text("welcome_sticker_id"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("managed_bots_owner_idx").on(t.ownerTelegramId),
    index("managed_bots_active_idx").on(t.isActive),
  ]
);
export type ManagedBot = typeof managedBots.$inferSelect;

// ─── Тикеты поддержки (общие для всех ботов системы) ──────────────────────────
// status: "open" | "claimed" | "closed"
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    // null = обращение пришло из главного бота
    botId: integer("bot_id"),
    botUsername: text("bot_username"),
    fromTelegramId: bigint("from_telegram_id", { mode: "number" }).notNull(),
    fromUsername: text("from_username"),
    fromFirstName: text("from_first_name"),
    status: text("status").default("open").notNull(),
    claimedByAdminId: bigint("claimed_by_admin_id", { mode: "number" }),
    claimedByUsername: text("claimed_by_username"),
    // { adminTelegramId: notificationMessageId } — чтобы снимать кнопку у всех админов разом
    notifiedMessages: jsonb("notified_messages").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("support_tickets_status_idx").on(t.status),
    index("support_tickets_from_idx").on(t.fromTelegramId),
  ]
);
export type SupportTicket = typeof supportTickets.$inferSelect;

// ─── Сообщения внутри тикетов (вся переписка админ ↔ пользователь) ────────────
export const supportMessages = pgTable(
  "support_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull(),
    senderTelegramId: bigint("sender_telegram_id", { mode: "number" }).notNull(),
    senderRole: text("sender_role").notNull(), // "user" | "admin"
    senderUsername: text("sender_username"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("support_messages_ticket_idx").on(t.ticketId)]
);
export type SupportMessage = typeof supportMessages.$inferSelect;
