import { NextRequest, NextResponse } from "next/server";
import { createBot, getBotInstance, deliverOrder } from "@/lib/bot/bot";
import { getOrderByExternalId } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

function getMainBot() {
  return (
    getBotInstance(null) ??
    createBot({ token: process.env.TELEGRAM_BOT_TOKEN ?? "", botId: null, botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "bot" })
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const secretKey = process.env.PLATEGA_SECRET_KEY ?? "";
    if (secretKey) {
      const signature = req.headers.get("x-signature") ?? req.headers.get("x-api-sign") ?? req.headers.get("x-platega-signature") ?? "";
      if (signature) {
        const crypto = await import("crypto");
        const expected = crypto.createHmac("sha256", secretKey).update(JSON.stringify(body)).digest("hex");
        if (expected !== signature) {
          console.warn("Platega: неверная подпись webhook");
          return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }
      }
    }

    const status = body.status ?? body.payment_status ?? body.state;
    const orderIdRaw = body.order_id ?? body.orderId ?? body.payload;
    const paymentId = body.transaction_id ?? body.id ?? body.payment_id;

    const isPaid = ["confirmed", "paid", "success", "completed", "CONFIRMED"].includes(status);
    if (!isPaid) {
      return NextResponse.json({ ok: true, message: "Событие проигнорировано" });
    }

    let orderId: number | null = null;
    if (orderIdRaw && String(orderIdRaw).startsWith("order_")) {
      orderId = parseInt(String(orderIdRaw).replace("order_", ""));
    }
    if (!orderId && paymentId) {
      const order = await getOrderByExternalId(String(paymentId));
      if (order) orderId = order.id;
    }
    if (!orderId) {
      console.error("Platega webhook: заказ не найден", body);
      return NextResponse.json({ ok: true });
    }

    const bot = getMainBot();
    if (!bot) return NextResponse.json({ ok: true });

    const { db } = await import("@/db");
    const { orders } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];
    if (order && order.status !== "paid") {
      const fakeCtx = { telegram: bot.telegram, reply: async () => {} } as unknown as Parameters<typeof deliverOrder>[0];
      await deliverOrder(fakeCtx, orderId, order.buyerTelegramId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Platega webhook error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Platega webhook активен" });
}
