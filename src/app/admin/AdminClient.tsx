"use client";

import { useEffect, useState, useCallback } from "react";

type Tab = "stats" | "products" | "coupons" | "orders" | "withdrawals" | "users" | "admins" | "bots" | "tickets" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "stats", label: "📊 Статистика" },
  { id: "products", label: "📦 Товары" },
  { id: "coupons", label: "🏷 Купоны" },
  { id: "orders", label: "📋 Заказы" },
  { id: "withdrawals", label: "💸 Выводы" },
  { id: "users", label: "👥 Пользователи" },
  { id: "admins", label: "🎧 Админы" },
  { id: "bots", label: "🤖 Боты" },
  { id: "tickets", label: "🆘 Поддержка" },
  { id: "settings", label: "⚙️ Настройки" },
];

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">{children}</div>;
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) } });
  return res.json();
}

export function AdminClient() {
  const [tab, setTab] = useState<Tab>("stats");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function notify(type: "success" | "error", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b1220] via-[#0f3460] to-[#0b1220] px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🔵 Панель управления ботом</h1>
            <p className="text-sm text-[#2aabee]">Магазин · Рефералы · Поддержка · Мультибот</p>
          </div>
          <a href="/" className="rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/20">← На сайт</a>
        </div>

        {msg && (
          <div className={`mb-4 rounded-xl border p-3 text-sm ${msg.type === "success" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
            {msg.text}
          </div>
        )}

        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                tab === t.id ? "bg-[#2aabee] text-white" : "bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "stats" && <StatsTab />}
        {tab === "products" && <ProductsTab notify={notify} />}
        {tab === "coupons" && <CouponsTab notify={notify} />}
        {tab === "orders" && <OrdersTab />}
        {tab === "withdrawals" && <WithdrawalsTab notify={notify} />}
        {tab === "users" && <UsersTab />}
        {tab === "admins" && <AdminsTab notify={notify} />}
        {tab === "bots" && <BotsTab />}
        {tab === "tickets" && <TicketsTab />}
        {tab === "settings" && <SettingsTab notify={notify} />}
      </div>
    </div>
  );
}

type Notify = (type: "success" | "error", text: string) => void;

function StatsTab() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api("/api/admin/stats").then((d) => setStats(d.stats));
  }, []);
  if (!stats) return <Card>Загрузка...</Card>;
  const items: [string, unknown][] = [
    ["👥 Пользователей", stats.users],
    ["🔗 Реф. ссылок", stats.links],
    ["🤖 Активных ботов", stats.activeBots],
    ["🛒 Покупок", stats.purchases],
    ["✅ Оплаченных заказов", stats.paidOrders],
    ["💰 Выручка (заказы)", `${stats.ordersRevenue} ₽`],
    ["💵 Общая выручка", `${stats.totalRevenue} ₽`],
    ["💎 Комиссий начислено", `${stats.totalCommissions} ₽`],
    ["📤 Выплачено рефералам", `${stats.totalPaidOut} ₽`],
    ["⏳ Ожид. выводов", stats.pendingWithdrawals],
    ["🆘 Открытых тикетов", stats.openTickets],
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <Card key={label}>
          <div className="text-xs text-white/50">{label}</div>
          <div className="mt-1 text-xl font-bold">{String(value)}</div>
        </Card>
      ))}
    </div>
  );
}

interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  productType: string;
  isActive: boolean;
}

function ProductsTab({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [productType, setProductType] = useState("digital");
  const [digitalContent, setDigitalContent] = useState("");
  const [channelId, setChannelId] = useState("");

  const load = useCallback(() => {
    api("/api/admin/products").then((d) => setList(d.products ?? []));
  }, []);
  useEffect(() => load(), [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const d = await api("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({ name, price, description, productType, digitalContent, channelId }),
    });
    if (d.ok) {
      notify("success", "Товар добавлен");
      setName(""); setPrice(""); setDescription(""); setDigitalContent(""); setChannelId("");
      load();
    } else notify("error", d.error ?? "Ошибка");
  }

  async function toggle(p: Product) {
    await api(`/api/admin/products/${p.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !p.isActive }) });
    load();
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">➕ Добавить товар</h2>
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Цена, ₽" type="number" value={price} onChange={(e) => setPrice(e.target.value)} required />
          <input className="input sm:col-span-2" placeholder="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="input" value={productType} onChange={(e) => setProductType(e.target.value)}>
            <option value="digital">Цифровой контент</option>
            <option value="invite_link">Ссылка-приглашение в канал</option>
          </select>
          {productType === "digital" ? (
            <input className="input" placeholder="Контент для выдачи" value={digitalContent} onChange={(e) => setDigitalContent(e.target.value)} />
          ) : (
            <input className="input" placeholder="ID канала (-100...)" value={channelId} onChange={(e) => setChannelId(e.target.value)} />
          )}
          <button className="btn-primary sm:col-span-2" type="submit">Добавить</button>
        </form>
      </Card>
      <div className="grid gap-3">
        {list.map((p) => (
          <Card key={p.id}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{p.isActive ? "✅" : "⛔️"} #{p.id} {p.name} — {p.price} ₽</div>
                <div className="text-xs text-white/50">{p.productType} · {p.description}</div>
              </div>
              <button onClick={() => toggle(p)} className="btn-secondary">{p.isActive ? "Отключить" : "Включить"}</button>
            </div>
          </Card>
        ))}
      </div>
      <style jsx>{`
        .input { border-radius: 0.75rem; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); padding: 0.5rem 0.75rem; font-size: 0.875rem; color: white; }
        .btn-primary { border-radius: 0.75rem; background: #2aabee; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 600; color: white; }
        .btn-secondary { border-radius: 0.75rem; background: rgba(255,255,255,0.1); padding: 0.4rem 0.8rem; font-size: 0.8rem; color: white; }
      `}</style>
    </div>
  );
}

interface Coupon {
  id: number;
  code: string;
  discountType: string;
  discountPercent: number;
  discountFixed: string;
  usageCount: number;
  usageLimit: number;
  isActive: boolean;
}

function CouponsTab({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState("10");

  const load = useCallback(() => {
    api("/api/admin/coupons").then((d) => setList(d.coupons ?? []));
  }, []);
  useEffect(() => load(), [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const d = await api("/api/admin/coupons", { method: "POST", body: JSON.stringify({ code, discountType: "percent", discountPercent }) });
    if (d.ok) { notify("success", "Купон создан"); setCode(""); load(); } else notify("error", d.error ?? "Ошибка");
  }

  async function remove(id: number) {
    await api(`/api/admin/coupons/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">➕ Добавить купон (% скидка)</h2>
        <form onSubmit={add} className="flex flex-wrap gap-3">
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" placeholder="Код (SALE20)" value={code} onChange={(e) => setCode(e.target.value)} required />
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm w-24" type="number" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
          <button className="rounded-xl bg-[#2aabee] px-4 py-2 text-sm font-semibold" type="submit">Создать</button>
        </form>
      </Card>
      <div className="grid gap-3">
        {list.map((c) => (
          <Card key={c.id}>
            <div className="flex items-center justify-between">
              <div>{c.isActive ? "✅" : "⛔️"} <code>{c.code}</code> — {c.discountType === "fixed" ? `${c.discountFixed}₽` : `${c.discountPercent}%`} (исп. {c.usageCount}/{c.usageLimit || "∞"})</div>
              {c.isActive && <button onClick={() => remove(c.id)} className="rounded-xl bg-white/10 px-3 py-1 text-xs">Деактивировать</button>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function OrdersTab() {
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api("/api/admin/orders").then((d) => setList(d.orders ?? [])); }, []);
  return (
    <div className="grid gap-3">
      {list.map((o) => (
        <Card key={o.id as number}>
          <div className="flex justify-between text-sm">
            <span>{o.status === "paid" ? "✅" : o.status === "pending" ? "⏳" : "❌"} #{o.id as number} — {o.amount as string} ₽ ({o.paymentMethod as string})</span>
            <span className="text-white/50">{o.buyerTelegramId as number}</span>
          </div>
        </Card>
      ))}
      {list.length === 0 && <Card>Заказов пока нет.</Card>}
    </div>
  );
}

function WithdrawalsTab({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const load = useCallback(() => { api("/api/admin/withdrawals").then((d) => setList(d.withdrawals ?? [])); }, []);
  useEffect(() => load(), [load]);

  async function act(id: number, status: "paid" | "rejected") {
    const d = await api(`/api/admin/withdrawals/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (d.ok) { notify("success", "Обновлено"); load(); } else notify("error", d.error ?? "Ошибка");
  }

  return (
    <div className="grid gap-3">
      {list.map((w) => (
        <Card key={w.id as number}>
          <div className="flex items-center justify-between text-sm">
            <span>#{w.id as number} — {w.username ? `@${w.username}` : (w.telegramId as number)} — {w.amountRub as string} ₽ ({w.status as string})</span>
            {w.status === "pending" && (
              <div className="flex gap-2">
                <button onClick={() => act(w.id as number, "paid")} className="rounded-lg bg-green-500/20 px-3 py-1 text-xs text-green-300">Выплатить</button>
                <button onClick={() => act(w.id as number, "rejected")} className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-300">Отклонить</button>
              </div>
            )}
          </div>
        </Card>
      ))}
      {list.length === 0 && <Card>Заявок нет.</Card>}
    </div>
  );
}

function UsersTab() {
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api("/api/admin/users").then((d) => setList(d.users ?? [])); }, []);
  return (
    <Card>
      <div className="max-h-[60vh] overflow-y-auto space-y-2 text-sm">
        {list.map((u) => (
          <div key={u.id as number} className="flex justify-between border-b border-white/5 py-1.5">
            <span>{u.username ? `@${u.username}` : (u.firstName as string)} ({u.telegramId as number})</span>
            <span className="text-white/40">{new Date(u.joinedAt as string).toLocaleDateString("ru-RU")}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AdminsTab({ notify }: { notify: Notify }) {
  const [data, setData] = useState<{ admins: Record<string, unknown>[]; ownerId: number } | null>(null);
  const [newId, setNewId] = useState("");
  const load = useCallback(() => { api("/api/admin/admins").then(setData); }, []);
  useEffect(() => load(), [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const d = await api("/api/admin/admins", { method: "POST", body: JSON.stringify({ telegramId: newId }) });
    if (d.ok) { notify("success", "Админ добавлен"); setNewId(""); load(); } else notify("error", d.error ?? "Ошибка");
  }
  async function remove(telegramId: number) {
    const d = await api(`/api/admin/admins?telegramId=${telegramId}`, { method: "DELETE" });
    if (d.ok) { notify("success", "Админ удалён"); load(); } else notify("error", d.error ?? "Ошибка");
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-2 text-lg font-semibold">👑 Главный владелец</h2>
        <p className="text-sm text-white/60">ID: {data?.ownerId} — задан в .env (OWNER_TELEGRAM_ID), его нельзя удалить.</p>
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">➕ Добавить админа поддержки</h2>
        <form onSubmit={add} className="flex gap-3">
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" placeholder="Telegram ID" value={newId} onChange={(e) => setNewId(e.target.value)} required />
          <button className="rounded-xl bg-[#2aabee] px-4 py-2 text-sm font-semibold" type="submit">Добавить</button>
        </form>
        <p className="mt-2 text-xs text-white/40">Обычные админы могут только отвечать пользователям через /reply — не имеют доступа к товарам/выводам/ботам.</p>
      </Card>
      <div className="grid gap-3">
        {(data?.admins ?? []).map((a) => (
          <Card key={a.id as number}>
            <div className="flex items-center justify-between text-sm">
              <span>🎧 {a.telegramId as number} {a.username ? `(@${a.username as string})` : ""}</span>
              <button onClick={() => remove(a.telegramId as number)} className="rounded-lg bg-red-500/20 px-3 py-1 text-xs text-red-300">Удалить</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function BotsTab() {
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api("/api/admin/bots").then((d) => setList(d.bots ?? [])); }, []);
  return (
    <div className="grid gap-3">
      {list.map((b) => (
        <Card key={b.id as number}>
          <div className="text-sm">
            {b.isActive ? "✅" : "⛔️"} @{b.botUsername as string} — владелец {b.ownerTelegramId as number}{b.ownerUsername ? ` (@${b.ownerUsername as string})` : ""}
          </div>
        </Card>
      ))}
      {list.length === 0 && <Card>Пока никто не создал своего бота через /createbot.</Card>}
    </div>
  );
}

function TicketsTab() {
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  useEffect(() => { api("/api/admin/tickets").then((d) => setList(d.tickets ?? [])); }, []);
  return (
    <div className="grid gap-3">
      {list.map((t) => (
        <Card key={t.id as number}>
          <div className="text-sm">
            <div className="mb-2 flex justify-between">
              <span>{t.status === "open" ? "🟦" : t.status === "claimed" ? "🟡" : "⚪️"} #{t.id as number} — {t.fromUsername ? `@${t.fromUsername as string}` : (t.fromTelegramId as number)} · бот: {(t.botUsername as string) ?? "главный"}</span>
              <span className="text-white/40">{t.status as string}</span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1 rounded-lg bg-black/20 p-2 text-xs">
              {((t.messages as Record<string, unknown>[]) ?? []).map((m) => (
                <div key={m.id as number} className={m.senderRole === "admin" ? "text-[#2aabee]" : "text-white/70"}>
                  {m.senderRole === "admin" ? "🎧" : "👤"} {m.text as string}
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
      {list.length === 0 && <Card>Обращений пока нет.</Card>}
    </div>
  );
}

function SettingsTab({ notify }: { notify: Notify }) {
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [welcomeStickerId, setWelcomeStickerId] = useState("");

  useEffect(() => {
    api("/api/admin/settings").then((d) => {
      setWelcomeMessage(d.settings?.welcomeMessage ?? "");
      setWelcomeStickerId(d.settings?.welcomeStickerId ?? "");
    });
  }, []);

  async function save() {
    const d = await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ welcomeMessage, welcomeStickerId }) });
    if (d.ok) notify("success", "Настройки сохранены"); else notify("error", "Ошибка сохранения");
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold">✏️ Приветственное сообщение (главный бот)</h2>
      <p className="mb-3 text-xs text-white/50">Переменные: {"{name}"} — имя пользователя, {"{ref_url}"} — реферальная ссылка. Также можно изменить через команду /setwelcome прямо в боте (там же можно прикрепить Premium-стикер, отправив его боту).</p>
      <textarea
        className="mb-3 h-40 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm"
        value={welcomeMessage}
        onChange={(e) => setWelcomeMessage(e.target.value)}
      />
      <label className="mb-1 block text-xs text-white/50">File ID стикера (необязательно, получить можно переслав стикер боту через /setwelcome)</label>
      <input
        className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
        value={welcomeStickerId}
        onChange={(e) => setWelcomeStickerId(e.target.value)}
        placeholder="CAACAgIAAxkBAAI..."
      />
      <button onClick={save} className="rounded-xl bg-[#2aabee] px-4 py-2 text-sm font-semibold">Сохранить</button>
    </Card>
  );
}
