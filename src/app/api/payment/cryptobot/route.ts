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

    const cryptoBotToken = process.env.CRYPTOBOT_TOKEN ?? "";
    const signature = req.headers.get("crypto-pay-api-signature");

    if (cryptoBotToken && signature) {
      const crypto = await import("crypto");
      const secret = crypto.createHash("sha256").update(cryptoBotToken).digest();
      const checkString = JSON.stringify(body);
      const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
      if (hmac !== signature) {
        console.warn("CryptoBot: неверная подпись webhook");
        return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
      }
    }

    if (body.update_type === "invoice_paid") {
      const invoice = body.payload;
      const invoiceId = String(invoice.invoice_id);
      const payload = invoice.payload as string | undefined;

      let orderId: number | null = null;
      if (payload && payload.startsWith("order_")) {
        orderId = parseInt(payload.replace("order_", ""));
      }
      if (!orderId) {
        const order = await getOrderByExternalId(invoiceId);
        if (order) orderId = order.id;
      }
      if (!orderId) {
        console.error("CryptoBot webhook: заказ не найден для invoice", invoiceId);
        return NextResponse.json({ ok: true });
      }

      const bot = getMainBot();
      if (!bot) return NextResponse.json({ ok: true });

      const fakeCtx = { telegram: bot.telegram, reply: async () => {} } as unknown as Parameters<typeof deliverOrder>[0];
      const { db } = await import("@/db");
      const { orders } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const order = orderRows[0];
      if (order && order.status !== "paid") {
        await deliverOrder(fakeCtx, orderId, order.buyerTelegramId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("CryptoBot webhook error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "CryptoBot webhook активен" });
}
