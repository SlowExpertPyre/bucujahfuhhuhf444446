import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await db.execute(sql`select 1`);
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "";

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0b1220] via-[#0f3460] to-[#0b1220] px-6 py-16 text-white">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-10 shadow-[0_24px_60px_rgba(0,0,0,0.3)] backdrop-blur-sm">
        <p className="m-0 text-sm uppercase tracking-[0.08em] text-[#2aabee]">Telegram Shop Bot</p>
        <h1 className="mt-4 text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.05]">
          Магазин + реферальная система + мультибот
        </h1>
        <p className="mt-4 text-base text-white/70">
          Полноценный Telegram-бот: магазин товаров, реферальная программа с динамической комиссией,
          поддержка через тикеты с онлайн-кнопками для админов и возможность создать собственного бота.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {botUsername && (
            <a
              href={`https://t.me/${botUsername}`}
              className="rounded-xl bg-[#2aabee] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#2aabee]/25 transition hover:bg-[#1d96d8]"
            >
              🚀 Открыть бота @{botUsername}
            </a>
          )}
          <a href="/admin" className="rounded-xl bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20">
            🔧 Панель управления
          </a>
        </div>
      </section>
    </main>
  );
}
