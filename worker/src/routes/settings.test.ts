import { describe, it, expect, vi } from 'vitest';
import { handleSettingsGet, handleSettingsUpdate } from './settings.js';

// We test the validation logic in isolation by extracting the relevant
// type-checking rules from handleFamilyUpdate. Since the handler is a
// Cloudflare Worker function (uses env.DB), we test only the pure
// validation branches that don't need a real DB.

// ── pocket_money_day ─────────────────────────────────────────────────────────

describe('pocket_money_day validation', () => {
  function isValidDay(v: unknown): boolean {
    return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6;
  }

  it('accepts 0 (Monday)', () => expect(isValidDay(0)).toBe(true));
  it('accepts 6 (Sunday)', () => expect(isValidDay(6)).toBe(true));
  it('accepts 3 (Thursday)', () => expect(isValidDay(3)).toBe(true));
  it('rejects 7', () => expect(isValidDay(7)).toBe(false));
  it('rejects -1', () => expect(isValidDay(-1)).toBe(false));
  it('rejects a string', () => expect(isValidDay('monday')).toBe(false));
  it('rejects a float', () => expect(isValidDay(1.5)).toBe(false));
});

// ── overdraft_enabled ────────────────────────────────────────────────────────

describe('overdraft_enabled validation', () => {
  function isValidEnabled(v: unknown): boolean {
    return v === 0 || v === 1 || v === true || v === false;
  }

  it('accepts 0', () => expect(isValidEnabled(0)).toBe(true));
  it('accepts 1', () => expect(isValidEnabled(1)).toBe(true));
  it('accepts true', () => expect(isValidEnabled(true)).toBe(true));
  it('accepts false', () => expect(isValidEnabled(false)).toBe(true));
  it('rejects a string', () => expect(isValidEnabled('yes')).toBe(false));
  it('rejects null', () => expect(isValidEnabled(null)).toBe(false));
});

// ── overdraft_limit_pence ────────────────────────────────────────────────────

describe('overdraft_limit_pence validation', () => {
  function isValidLimit(v: unknown): boolean {
    return Number.isInteger(v) && (v as number) >= 0;
  }

  it('accepts 0', () => expect(isValidLimit(0)).toBe(true));
  it('accepts 1000 (£10)', () => expect(isValidLimit(1000)).toBe(true));
  it('rejects -1', () => expect(isValidLimit(-1)).toBe(false));
  it('rejects a float', () => expect(isValidLimit(9.99)).toBe(false));
  it('rejects a string', () => expect(isValidLimit('100')).toBe(false));
});

// ── high_contrast (validation logic mirror) ────────────────────────────────
// Mirrors settingsUpdateSchema's high_contrast refine in settings.ts — a
// per-user accessibility preference, boolean-like (0/1/true/false). See
// the "handler integration" block below for tests against the real
// handlers/DB — this block only covers the standalone predicate shape,
// consistent with the pocket_money_day / overdraft_* blocks above.

describe('high_contrast validation', () => {
  function isValidHighContrast(v: unknown): boolean {
    return v === undefined || v === 0 || v === 1 || v === true || v === false;
  }

  it('accepts 0', () => expect(isValidHighContrast(0)).toBe(true));
  it('accepts 1', () => expect(isValidHighContrast(1)).toBe(true));
  it('accepts true', () => expect(isValidHighContrast(true)).toBe(true));
  it('accepts false', () => expect(isValidHighContrast(false)).toBe(true));
  it('rejects a non-boolean value ("yes")', () => expect(isValidHighContrast('yes')).toBe(false));
  it('rejects null', () => expect(isValidHighContrast(null)).toBe(false));
});

// ── high_contrast (handler integration) ─────────────────────────────────────
// Exercises the real handleSettingsGet / handleSettingsUpdate handlers
// against a mocked env.DB + env.CACHE, in the same style as
// childSettings.test.ts's makeEnv() — so a bug in any of the four SQL
// sites touched for high_contrast (the SELECT, both INSERT fallbacks, and
// the dynamic UPDATE) would actually be caught here.
//
// The DB mock keeps a single mutable `row` (the user_settings row, or
// null pre-provisioning) and dispatches on the SQL text, generically
// parsing the dynamic `UPDATE user_settings SET <cols> WHERE user_id = ?`
// clause built by handleSettingsUpdate so it stays correct as other
// fields are added/removed from that statement.

type SettingsRow = {
  user_id: string; avatar_id: string; theme: string; locale: string; app_view: string;
  high_contrast: number; earnings_mode: string; allowance_amount: number; allowance_frequency: string;
};

function makeSettingsEnv(initialRow: SettingsRow | null) {
  let row = initialRow;
  const userRow = { earnings_mode: 'CHORES', allowance_amount: 0, allowance_frequency: 'WEEKLY' };

  const prepare = vi.fn((sql: string) => {
    // GET's main SELECT: user_settings JOIN users
    if (/SELECT us\.user_id, us\.avatar_id/.test(sql)) {
      return { bind: () => ({ first: async () => row }) };
    }
    // Fresh-user default-insert (GET's no-row branch, and PATCH's .catch fallback).
    // high_contrast/app_view are hard-coded literals (0 / 'ORCHARD') in this
    // statement, not bound params — see settings.ts Steps 5/6.
    if (/INSERT INTO user_settings/.test(sql)) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (!row) {
              const [userId, avatarId, theme, locale] = args as [string, string, string, string, number];
              row = {
                user_id: userId, avatar_id: avatarId, theme, locale, app_view: 'ORCHARD',
                high_contrast: 0,
                earnings_mode: userRow.earnings_mode,
                allowance_amount: userRow.allowance_amount,
                allowance_frequency: userRow.allowance_frequency,
              };
            }
            return { success: true };
          },
        }),
      };
    }
    // GET's no-row branch: earnings_mode lookup on `users`
    if (/SELECT earnings_mode, allowance_amount, allowance_frequency FROM users/.test(sql)) {
      return { bind: () => ({ first: async () => userRow }) };
    }
    // PATCH's dynamic UPDATE — parse the SET clause generically so this
    // mock doesn't need per-field special-casing.
    if (/UPDATE user_settings SET/.test(sql)) {
      const setClause = sql.match(/SET (.+) WHERE/)?.[1] ?? '';
      const cols = setClause.split(',').map(s => s.trim().split(' = ')[0]);
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (!row) throw new Error('no user_settings row to update');
            cols.forEach((col, i) => { (row as unknown as Record<string, unknown>)[col] = args[i]; });
            return { success: true };
          },
        }),
      };
    }
    // PATCH's locale side-effect write to `users`
    if (/UPDATE users SET locale/.test(sql)) {
      return { bind: () => ({ run: async () => ({ success: true }) }) };
    }
    return { bind: () => ({ first: async () => null, run: async () => ({ success: true }) }) };
  });

  const CACHE = {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };

  return { DB: { prepare }, CACHE } as any;
}

describe('high_contrast setting — handler integration', () => {
  it('GET with a fresh user (no user_settings row) returns high_contrast: 0', async () => {
    const env = makeSettingsEnv(null);
    const req = new Request('https://x/api/settings');
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handleSettingsGet(req, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { high_contrast: number };
    expect(body.high_contrast).toBe(0);
  });

  it('PATCH { high_contrast: true } persists 1, and a follow-up GET reflects it', async () => {
    const env = makeSettingsEnv({
      user_id: 'child_1', avatar_id: 'bottts:spark', theme: 'system', locale: 'en', app_view: 'ORCHARD',
      high_contrast: 0, earnings_mode: 'CHORES', allowance_amount: 0, allowance_frequency: 'WEEKLY',
    });
    const auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const patchReq = new Request('https://x/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ high_contrast: true }),
    });
    (patchReq as any).auth = auth;
    const patchRes = await handleSettingsUpdate(patchReq, env);
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json() as { ok: boolean };
    expect(patchBody.ok).toBe(true);

    const getReq = new Request('https://x/api/settings');
    (getReq as any).auth = auth;
    const getRes = await handleSettingsGet(getReq, env);
    const getBody = await getRes.json() as { high_contrast: number };
    expect(getBody.high_contrast).toBe(1);
  });

  it('rejects a non-boolean high_contrast value with a 400-level error', async () => {
    const env = makeSettingsEnv({
      user_id: 'child_1', avatar_id: 'bottts:spark', theme: 'system', locale: 'en', app_view: 'ORCHARD',
      high_contrast: 0, earnings_mode: 'CHORES', allowance_amount: 0, allowance_frequency: 'WEEKLY',
    });
    const req = new Request('https://x/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ high_contrast: 'yes' }),
    });
    (req as any).auth = { sub: 'child_1', family_id: 'fam_1', role: 'child' };

    const res = await handleSettingsUpdate(req, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/high_contrast/);
  });
});
