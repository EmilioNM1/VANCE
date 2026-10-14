import { NextResponse, type NextRequest } from "next/server";

/** Redirección temprana: la validación real de la sesión se hace en el servidor (requireUser). */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("vance_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
