import { NextResponse } from "next/server";
import { getTotalStats } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getTotalStats();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
