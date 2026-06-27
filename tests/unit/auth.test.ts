import { describe, it, expect } from 'vitest';
import { isAuthedCookie } from '../../src/lib/auth';

describe('isAuthedCookie', () => {
  it('returns true when the cookie matches the password', () => {
    expect(isAuthedCookie('secret123', 'secret123')).toBe(true);
  });
  it('returns false when the cookie is missing', () => {
    expect(isAuthedCookie(undefined, 'secret123')).toBe(false);
  });
  it('returns false when the cookie does not match', () => {
    expect(isAuthedCookie('wrong', 'secret123')).toBe(false);
  });
});
