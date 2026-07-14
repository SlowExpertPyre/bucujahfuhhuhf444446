import { NextRequest, NextResponse } from "next/server";
import { processWithdrawal } from "@/lib/bot/helpers";
import { getBotInstance, createBot } from "@/lib/bot/bot";
import { formatMoney } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

function getMainBot() {
  return (
    getBotInstance(null) ??
    createBot({ token: process.env.TELEGRAM_BOT_TOKEN ?? "", botId: null, botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "bot" })
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const status = body.status as "paid" | "rejected";
  if (status !== "paid" && status !== "rejected") {
    return NextResponse.json({ ok: false, error: "status должен быть paid или rejected" }, { status: 400 });
  }
  const req_ = await processWithdrawal(parseInt(id), status, body.cryptoCheckToken, body.adminNote);
  if (!req_) return NextResponse.json({ ok: false, error: "Заявка не найдена" }, { status: 404 });

  const bot = getMainBot();
  if (bot) {
    try {
      if (status === "paid") {
        await bot.telegram.sendMessage(req_.telegramId, `✅ Выплата произведена!\n\n💰 Сумма: ${formatMoney(req_.amountRub)}\n💵 USDT: ${req_.amountUsdt}`);
      } else {
        await bot.telegram.sendMessage(req_.telegramId, `❌ Заявка на вывод отклонена.\n💰 Сумма ${formatMoney(req_.amountRub)} возвращена на баланс.`);
      }
    } catch {
      // пользователь недоступен
    }
  }

  return NextResponse.json({ ok: true, request: req_ });
}
