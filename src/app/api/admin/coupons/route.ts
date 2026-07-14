import { NextRequest, NextResponse } from "next/server";
import { getAllCoupons, createCoupon } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await getAllCoupons();
  return NextResponse.json({ ok: true, coupons: list });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.code) return NextResponse.json({ ok: false, error: "code обязателен" }, { status: 400 });
    const coupon = await createCoupon({
      code: body.code,
      discountType: body.discountType,
      discountPercent: body.discountPercent ? Number(body.discountPercent) : undefined,
      discountFixed: body.discountFixed ? Number(body.discountFixed) : undefined,
      limitType: body.limitType,
      usageLimit: body.usageLimit ? Number(body.usageLimit) : undefined,
      maxDiscountAmount: body.maxDiscountAmount ? Number(body.maxDiscountAmount) : undefined,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    return NextResponse.json({ ok: true, coupon });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
