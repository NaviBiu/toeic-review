import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: '密码不正确' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, password, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}
