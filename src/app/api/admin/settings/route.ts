import { NextRequest, NextResponse } from "next/server";
import { getBotSetting, setBotSetting } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

const DEFAULT_WELCOME =
  "👋 Привет, {name}!\n\nДобро пожаловать в наш магазин с реферальной программой.\n\n🔗 Ваша реферальная ссылка:\n{ref_url}\n\n📢 Делитесь ссылкой и получайте % комиссии с каждой покупки ваших рефералов!";

export async function GET() {
  const welcomeMessage = await getBotSetting("welcome_message", DEFAULT_WELCOME);
  const welcomeStickerId = await getBotSetting("welcome_sticker_id", "");
  return NextResponse.json({ ok: true, settings: { welcomeMessage, welcomeStickerId } });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (typeof body.welcomeMessage === "string") await setBotSetting("welcome_message", body.welcomeMessage);
  if (typeof body.welcomeStickerId === "string") await setBotSetting("welcome_sticker_id", body.welcomeStickerId);
  return NextResponse.json({ ok: true });
}
