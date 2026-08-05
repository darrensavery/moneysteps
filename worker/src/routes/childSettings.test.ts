import { describe, it, expect, vi } from 'vitest';
import { handleSetChildBirthDate } from './childSettings.js';

function makeEnv(overrides: Partial<{ first: unknown; run: unknown }> = {}) {
  const first = vi.fn().mockResolvedValue(overrides.first ?? { family_id: 'fam_1' });
  const run = vi.fn().mockResolvedValue(overrides.run ?? { success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { DB: { prepare } } as any;
}

describe('handleSetChildBirthDate', () => {
  it('rejects a non-parent caller', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '2013-06-15' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(403);
  });

  it('rejects an implausible birth date', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '1950-01-01' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(400);
  });

  it('rejects a malformed date string', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: 'not-a-date' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(400);
  });

  it('accepts a plausible birth date from a parent', async () => {
    const req = new Request('https://x/api/children/child_1/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '2013-06-15' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const res = await handleSetChildBirthDate(req, makeEnv(), 'child_1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ birth_date: '2013-06-15' });
  });
});
