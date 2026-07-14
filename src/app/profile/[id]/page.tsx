import { getPublicProfile, calcDynamicCommissionPercent, formatMoney } from "@/lib/bot/helpers";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

function getMedal(rank: number): string {
  if (rank <= 5) return MEDALS[rank - 1];
  return `#${rank}`;
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const telegramId = parseInt(id);
  if (isNaN(telegramId)) notFound();

  const profile = await getPublicProfile(telegramId);
  if (!profile) notFound();

  const displayName = profile.username
    ? `@${profile.username}`
    : profile.firstName
    ? `${profile.firstName}${profile.lastName ? " " + profile.lastName : ""}`
    : `Пользователь #${telegramId}`;

  const joinedAt = new Date(profile.joinedAt).toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" });
  const commPct = profile.commissionPercent;
  const toNextThreshold = Math.max(0, profile.nextThreshold - profile.totalRefPurchases);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors">
          ← На главную
        </Link>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-8">
          <div className="flex items-start gap-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-[#2aabee] flex items-center justify-center text-2xl font-bold shadow-lg shrink-0">
              {(profile.firstName?.[0] ?? profile.username?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">{displayName}</h1>
                <span className="text-2xl">{getMedal(profile.rank)}</span>
              </div>
              <p className="text-slate-400 text-sm mt-1">В боте с {joinedAt}</p>
              {profile.referralCode && (
                <code className="mt-2 inline-block text-xs text-[#2aabee] bg-[#2aabee]/10 px-2 py-0.5 rounded-lg">Код: {profile.referralCode}</code>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: "Рефералов привлечено", value: profile.referredCount, icon: "👥" },
            { label: "Через ботов", value: profile.breakdown.botRefs, icon: "🤖" },
            { label: "Из них купили", value: profile.uniqueBuyers, icon: "🛒" },
            { label: "Кликов по ссылке", value: profile.clickCount, icon: "👆" },
            { label: "Объём покупок", value: formatMoney(profile.refRevenue), icon: "💰" },
            { label: "Комиссия", value: `${commPct}%`, icon: "💹" },
            { label: "Место в рейтинге", value: `#${profile.rank}`, icon: "🏆" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl bg-white/5 border border-white/10 p-5 hover:bg-white/10 transition-colors">
              <div className="text-2xl mb-2">{item.icon}</div>
              <div className="text-xl font-bold">{item.value}</div>
              <div className="text-xs text-slate-400 mt-1">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-white/5 border border-white/10 p-6">
          <h2 className="text-lg font-semibold mb-4">💹 Прогресс комиссии</h2>
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-slate-400">Текущий уровень</span>
            <span className="font-bold text-[#2aabee]">{commPct}%</span>
          </div>
          <div className="relative h-3 rounded-full bg-white/10 overflow-hidden mb-2">
            {profile.totalRefPurchases < 5000 ? (
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-[#2aabee] transition-all"
                style={{ width: `${Math.min(100, (profile.totalRefPurchases / 5000) * 100)}%` }}
              />
            ) : (
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                style={{ width: `${Math.min(100, ((profile.totalRefPurchases - 5000) % 1000) / 10)}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{formatMoney(profile.totalRefPurchases)} объём</span>
            {toNextThreshold > 0 ? (
              <span>До {profile.nextPercent}%: {formatMoney(toNextThreshold)}</span>
            ) : (
              <span className="text-green-400">🎉 Максимум!</span>
            )}
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {[
              { threshold: 0, percent: 40, label: "Начальный уровень" },
              { threshold: 5000, percent: 50, label: "После 5 000 ₽" },
              { threshold: 6000, percent: 51, label: "После 6 000 ₽" },
              { threshold: 7000, percent: 52, label: "После 7 000 ₽" },
              { threshold: 10000, percent: 55, label: "После 10 000 ₽" },
            ].map((level) => {
              const isActive = profile.totalRefPurchases >= level.threshold && calcDynamicCommissionPercent(profile.totalRefPurchases) >= level.percent;
              return (
                <div key={level.threshold} className={`flex justify-between items-center py-1.5 px-3 rounded-lg ${isActive ? "bg-[#2aabee]/10 border border-[#2aabee]/20" : "bg-white/5"}`}>
                  <span className={isActive ? "text-[#2aabee]" : "text-slate-500"}>
                    {isActive ? "✅" : "○"} {level.label}
                  </span>
                  <span className={`font-bold ${isActive ? "text-[#2aabee]" : "text-slate-500"}`}>{level.percent}%</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-gradient-to-r from-[#2aabee]/20 to-blue-600/20 border border-[#2aabee]/30 p-6 text-center">
          <p className="text-white font-semibold mb-2">🤖 Хотите зарабатывать тоже?</p>
          <p className="text-slate-400 text-sm mb-4">Присоединяйтесь и получайте от 40% комиссии с каждой покупки ваших рефералов, либо создайте своего бота командой /createbot</p>
          <a
            href={`https://t.me/${process.env.TELEGRAM_BOT_USERNAME ?? "bot"}`}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2aabee] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#2aabee]/25 transition hover:bg-[#1d96d8]"
          >
            🚀 Запустить бота
          </a>
        </div>
      </div>
    </main>
  );
}
