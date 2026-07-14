import { NextResponse } from "next/server";
import { getAllTickets, getTicketMessages } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const tickets = await getAllTickets(100);
  const withMessages = await Promise.all(
    tickets.map(async (t) => ({ ...t, messages: await getTicketMessages(t.id) }))
  );
  return NextResponse.json({ ok: true, tickets: withMessages });
}
