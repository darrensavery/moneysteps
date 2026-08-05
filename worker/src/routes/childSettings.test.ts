import { describe, it, expect, vi } from 'vitest';
import { handleSetChildBirthDate } from './childSettings.js';

/**
 * Simulates the real family_roles-backed users table: `first()` only resolves
 * a row when the bound (childId, familyId) pair matches a family member whose
 * role is 'child' — mirroring the `WHERE u.id = ? AND fr.family_id = ? AND
 * fr.role = 'child'` predicate in the handler. This lets tests distinguish
 * "target is a child in this family" from "target is a parent/co-parent in
 * this family" (a plain object mock can't, since it ignores the SQL/params).
 */
function makeEnv(options: {
  members?: Array<{ id: string; family_id: string; role: 'child' | 'parent' }>;
  run?: unknown;
} = {}) {
  const members = options.members ?? [{ id: 'child_1', family_id: 'fam_1', role: 'child' }];
  const run = vi.fn().mockResolvedValue(options.run ?? { success: true });

  const prepare = vi.fn().mockImplementation((sql: string) => {
    const isSelect = /SELECT/i.test(sql);
    return {
      bind: vi.fn().mockImplementation((...args: unknown[]) => ({
        first: vi.fn().mockImplementation(async () => {
          if (!isSelect) return null;
          const [childId, familyId] = args as [string, string];
          const match = members.find(
            (m) => m.id === childId && m.family_id === familyId && m.role === 'child',
          );
          return match ? { id: match.id } : null;
        }),
        run,
      })),
    };
  });
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

  it('rejects a target user in the same family who is a parent/co-parent, not a child', async () => {
    const req = new Request('https://x/api/children/parent_2/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '2013-06-15' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const env = makeEnv({
      members: [
        { id: 'parent_2', family_id: 'fam_1', role: 'parent' },
        { id: 'child_1', family_id: 'fam_1', role: 'child' },
      ],
    });
    const res = await handleSetChildBirthDate(req, env, 'parent_2');
    expect(res.status).toBe(403);
  });

  it('rejects a target user from a different family, even with the same role', async () => {
    const req = new Request('https://x/api/children/child_9/birth-date', {
      method: 'PATCH',
      body: JSON.stringify({ birth_date: '2013-06-15' }),
    });
    (req as any).auth = { sub: 'parent_1', family_id: 'fam_1', role: 'parent' };
    const env = makeEnv({ members: [{ id: 'child_9', family_id: 'fam_2', role: 'child' }] });
    const res = await handleSetChildBirthDate(req, env, 'child_9');
    expect(res.status).toBe(403);
  });
});
