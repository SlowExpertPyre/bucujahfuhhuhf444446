import { NextRequest, NextResponse } from "next/server";
import { recordPurchase } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId, amount, description } = await req.json();
    if (!userId || !amount) {
      return NextResponse.json({ ok: false, error: "userId и amount обязательны" }, { status: 400 });
    }
    const result = await recordPurchase(Number(userId), Number(amount), description ?? "Ручная покупка");
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
