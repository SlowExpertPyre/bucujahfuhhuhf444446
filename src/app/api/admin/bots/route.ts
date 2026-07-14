import { NextResponse } from "next/server";
import { getAllManagedBots } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await getAllManagedBots();
  // Не отдаём токены во фронтенд
  const safe = list.map(({ token: _token, ...rest }) => rest);
  return NextResponse.json({ ok: true, bots: safe });
}
