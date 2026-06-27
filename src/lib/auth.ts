export function isAuthedCookie(cookieValue: string | undefined, expectedPassword: string): boolean {
  return !!cookieValue && cookieValue === expectedPassword;
}

export const AUTH_COOKIE_NAME = 'toeic_auth';
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
