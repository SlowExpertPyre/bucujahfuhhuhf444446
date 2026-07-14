import { NextResponse } from "next/server";
import { getRecentOrders } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await getRecentOrders(100);
  return NextResponse.json({ ok: true, orders: list });
}
