import { NextRequest, NextResponse } from "next/server";
import { getPublicProfile } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const telegramId = parseInt(id);
    if (isNaN(telegramId)) {
      return NextResponse.json({ ok: false, error: "Неверный ID" }, { status: 400 });
    }
    const profile = await getPublicProfile(telegramId);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "Профиль не найден" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
