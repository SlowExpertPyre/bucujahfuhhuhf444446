import { db } from "@/db";
import { products } from "@/db/schema";

export const dynamic = "force-dynamic";

const INITIAL_PRODUCTS = [
  {
    name: "VIP доступ на 30 дней",
    description: "Приглашение в закрытый VIP-канал на 30 дней",
    price: "990.00",
    productType: "digital",
    digitalContent: "Спасибо за покупку! Ваш VIP-статус активирован на 30 дней.",
  },
  {
    name: "Консультация 1 час",
    description: "Индивидуальная консультация с экспертом",
    price: "2500.00",
    productType: "digital",
    digitalContent: "Напишите /reply в поддержку, чтобы согласовать удобное время.",
  },
];

export async function POST() {
  const inserted = await db.insert(products).values(INITIAL_PRODUCTS).onConflictDoNothing().returning();
  return Response.json({ seeded: inserted.length, products: inserted });
}
