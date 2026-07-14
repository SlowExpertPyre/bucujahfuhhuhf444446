import { NextRequest, NextResponse } from "next/server";
import { updateProduct, deleteProduct } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  await updateProduct(parseInt(id), body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteProduct(parseInt(id));
  return NextResponse.json({ ok: true });
}
