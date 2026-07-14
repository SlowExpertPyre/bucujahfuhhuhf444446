import { NextRequest, NextResponse } from "next/server";
import { createBot, getBotInstance } from "@/lib/bot/bot";

export const dynamic = "force-dynamic";

function getMainBot() {
  let b = getBotInstance(null);
  if (!b) {
    const created = createBot({
      token: process.env.TELEGRAM_BOT_TOKEN ?? "",
      botId: null,
      botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "bot",
    });
    b = created ?? undefined;
  }
  return b;
}

export async function POST(req: NextRequest) {
  const b = getMainBot();
  if (!b) {
    return NextResponse.json({ ok: false, error: "Бот не настроен (нет TELEGRAM_BOT_TOKEN)" }, { status: 503 });
  }
  try {
    const body = await req.json();
    await b.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Ошибка Telegram webhook:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Telegram webhook работает. Используется только при BOT_MODE=webhook." });
}
