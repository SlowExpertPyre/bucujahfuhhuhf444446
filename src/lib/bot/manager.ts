import { createBot, getBotInstance, type BotInstanceConfig } from "./bot";
import { getActiveManagedBots } from "./helpers";
import type { ManagedBot } from "@/db/schema";

const MAIN_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const MAIN_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "";

let started = false;

async function safeLaunch(config: BotInstanceConfig) {
  const bot = createBot(config);
  if (!bot) return null;
  try {
    // Снимаем вебхук на всякий случай, чтобы polling не конфликтовал с ним.
    await bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    // launch() не резолвится, пока бот не остановлен — не ждём его тут.
    bot.launch().catch((e: unknown) => {
      console.error(`Бот @${config.botUsername} упал:`, e);
    });
    console.log(`✅ Бот @${config.botUsername} запущен (polling)`);
    return bot;
  } catch (e) {
    console.error(`Не удалось запустить бота @${config.botUsername}:`, e);
    return null;
  }
}

// ─── Запуск конкретного созданного пользователем бота (используется и при
// динамическом создании через /createbot, и при старте сервера) ──────────────
export async function launchManagedBot(row: ManagedBot) {
  if (!row.isActive) return null;
  if (getBotInstance(row.id)) return getBotInstance(row.id)!; // уже запущен
  return safeLaunch({ token: row.token, botId: row.id, botUsername: row.botUsername });
}

// ─── Запуск главного бота + всех активных созданных ботов при старте сервера ──
export async function startAllBots() {
  if (started) return;
  started = true;

  if (!MAIN_TOKEN) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN не задан — главный бот не запущен");
  } else {
    await safeLaunch({ token: MAIN_TOKEN, botId: null, botUsername: MAIN_USERNAME || "bot" });
  }

  try {
    const managed = await getActiveManagedBots();
    for (const row of managed) {
      await launchManagedBot(row);
    }
    if (managed.length > 0) {
      console.log(`✅ Запущено дополнительных ботов пользователей: ${managed.length}`);
    }
  } catch (e) {
    console.error("Не удалось загрузить список созданных ботов из БД:", e);
  }
}

export function stopAllBots(signal: string) {
  console.log(`Останавливаем ботов (${signal})...`);
}
