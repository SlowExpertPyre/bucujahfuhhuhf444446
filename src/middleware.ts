import { NextRequest, NextResponse } from "next/server";

// Простая Basic Auth защита для веб-панели /admin и её API.
// Логин: admin, пароль: значение ADMIN_PANEL_PASSWORD из .env (по умолчанию "admin123" —
// обязательно смените в .env перед боевым использованием!).
export function middleware(req: NextRequest) {
  const password = process.env.ADMIN_PANEL_PASSWORD || "admin123";
  const authHeader = req.headers.get("authorization");

  if (authHeader) {
    const base64 = authHeader.split(" ")[1] || "";
    const [, pass] = Buffer.from(base64, "base64").toString().split(":");
    if (pass === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Требуется авторизация", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin Panel"' },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
