import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN не задан" }, { status: 400 });
  }

  const { webhookUrl } = await req.json();
  if (!webhookUrl) {
    return NextResponse.json({ error: "webhookUrl обязателен" }, { status: 400 });
  }

  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const data = await res.json();
  return NextResponse.json(data);
}

export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN не задан" }, { status: 400 });
  }
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const res = await fetch(url);
  const data = await res.json();
  return NextResponse.json(data);
}
