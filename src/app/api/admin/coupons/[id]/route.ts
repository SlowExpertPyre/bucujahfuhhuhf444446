import { NextRequest, NextResponse } from "next/server";
import { deactivateCoupon } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deactivateCoupon(parseInt(id));
  return NextResponse.json({ ok: true });
}
