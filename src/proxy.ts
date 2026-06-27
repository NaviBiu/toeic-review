import { NextRequest, NextResponse } from 'next/server';
import { isAuthedCookie, AUTH_COOKIE_NAME } from '@/lib/auth';

export function proxy(req: NextRequest) {
  const isPublic = req.nextUrl.pathname === '/login' || req.nextUrl.pathname === '/api/auth';
  if (isPublic) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!isAuthedCookie(cookie, process.env.APP_PASSWORD ?? '')) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
