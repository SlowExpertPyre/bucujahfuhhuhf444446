import { NextRequest, NextResponse } from "next/server";
import { getAllProductsAdmin, createProduct } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await getAllProductsAdmin();
  return NextResponse.json({ ok: true, products: list });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !body.price) {
      return NextResponse.json({ ok: false, error: "name и price обязательны" }, { status: 400 });
    }
    const product = await createProduct({
      name: body.name,
      description: body.description ?? null,
      price: Number(body.price),
      productType: body.productType ?? "digital",
      channelId: body.channelId,
      digitalContent: body.digitalContent,
    });
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
