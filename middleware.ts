import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  // Supabase 浏览器 SDK 会在 cookie 中保存 sb-access-token / sb-refresh-token。
  // 我们用其存在与否作为登录态的快速判断。
  const hasSession = Boolean(
    request.cookies.get("sb-access-token") || request.cookies.get("supabase-auth-token"),
  );

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配除 _next / api / 静态文件 / 公开图标外的所有路径。
     */
    "/((?!_next|api|icons|manifest.json|sw.js|favicon.ico).*)",
  ],
};
