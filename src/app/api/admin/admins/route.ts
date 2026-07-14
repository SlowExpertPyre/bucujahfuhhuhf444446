import { NextRequest, NextResponse } from "next/server";
import { getAdminList, addAdminToDb, removeAdminFromDb } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

const OWNER_ID = parseInt(process.env.OWNER_TELEGRAM_ID ?? "0");

export async function GET() {
  const list = await getAdminList();
  return NextResponse.json({ ok: true, admins: list, ownerId: OWNER_ID });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const telegramId = Number(body.telegramId);
  if (!telegramId) return NextResponse.json({ ok: false, error: "telegramId обязателен" }, { status: 400 });
  if (telegramId === OWNER_ID) return NextResponse.json({ ok: false, error: "Это и так владелец" }, { status: 400 });
  const row = await addAdminToDb(telegramId, body.username, OWNER_ID);
  return NextResponse.json({ ok: true, admin: row });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const telegramId = Number(searchParams.get("telegramId"));
  if (!telegramId) return NextResponse.json({ ok: false, error: "telegramId обязателен" }, { status: 400 });
  if (telegramId === OWNER_ID) return NextResponse.json({ ok: false, error: "Владельца удалить нельзя" }, { status: 400 });
  await removeAdminFromDb(telegramId);
  return NextResponse.json({ ok: true });
}
