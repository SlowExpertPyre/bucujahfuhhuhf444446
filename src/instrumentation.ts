// Next.js вызывает register() один раз при старте сервера (Node.js runtime).
// Здесь мы запускаем Telegram-ботов через long polling — это не требует
// белого IP, домена или webhook, поэтому бот прекрасно работает даже
// на обычном ПК в РФ без VPN (api.telegram.org не заблокирован).
//
// Если вы предпочитаете вебхук (например, при деплое на сервер с доменом),
// установите переменную окружения BOT_MODE=webhook — тогда автозапуск
// polling отключится, и нужно будет вызвать POST /api/telegram/webhook-setup.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BOT_MODE === "webhook") {
    console.log("ℹ️ BOT_MODE=webhook — polling не запускается. Настройте вебхук через /api/telegram/webhook-setup");
    return;
  }

  const { startAllBots } = await import("./lib/bot/manager");
  await startAllBots().catch((e) => console.error("Ошибка запуска ботов:", e));
}
