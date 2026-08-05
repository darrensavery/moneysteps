import { describe, it, expect } from 'vitest';
import { isTeenAccount } from './ageGate.js';

describe('isTeenAccount', () => {
  const now = new Date('2026-08-05T00:00:00Z');

  it('returns false when birth_date is null', () => {
    expect(isTeenAccount(null, now)).toBe(false);
  });

  it('returns false for an unparseable birth_date', () => {
    expect(isTeenAccount('not-a-date', now)).toBe(false);
  });

  it('returns true for someone who already turned 13 earlier this year', () => {
    expect(isTeenAccount('2013-01-01', now)).toBe(true);
  });

  it('returns false for someone who does not turn 13 until later this year', () => {
    expect(isTeenAccount('2013-12-31', now)).toBe(false);
  });

  it('returns true for someone whose 13th birthday is today', () => {
    expect(isTeenAccount('2013-08-05', now)).toBe(true);
  });

  it('returns true for someone who turns 18 later this year (still 17 today)', () => {
    expect(isTeenAccount('2008-12-31', now)).toBe(true);
  });

  it('returns false for someone who already turned 18 earlier this year', () => {
    expect(isTeenAccount('2008-01-01', now)).toBe(false);
  });
});
