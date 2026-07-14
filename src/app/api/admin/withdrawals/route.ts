import { NextResponse } from "next/server";
import { getAllWithdrawals } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await getAllWithdrawals(100);
  return NextResponse.json({ ok: true, withdrawals: list });
}
