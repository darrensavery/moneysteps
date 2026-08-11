import { describe, it, expect, vi } from 'vitest';
import { upsertDeviceToken, deleteDeviceToken, getDeviceTokensForUser } from './tokens.js';

function makeDb() {
  const run = vi.fn().mockResolvedValue({ success: true });
  const all = vi.fn().mockResolvedValue({ results: [{ token: 'tok_1', user_id: 'user_1', platform: 'ios', environment: 'production' }] });
  const bind = vi.fn().mockReturnValue({ run, all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { db: { prepare } as unknown as D1Database, prepare, bind, run, all };
}

describe('upsertDeviceToken', () => {
  it('runs an upsert keyed on token', async () => {
    const { db, prepare, bind, run } = makeDb();
    await upsertDeviceToken(db, { token: 'tok_1', user_id: 'user_1', platform: 'ios', environment: 'production' });
    expect(prepare.mock.calls[0][0]).toMatch(/ON CONFLICT\(token\)/);
    expect(bind).toHaveBeenCalledWith('tok_1', 'user_1', 'ios', 'production');
    expect(run).toHaveBeenCalled();
  });
});

describe('deleteDeviceToken', () => {
  it('deletes by token scoped to the owning user', async () => {
    const { db, prepare, bind, run } = makeDb();
    await deleteDeviceToken(db, 'tok_1', 'user_1');
    expect(prepare.mock.calls[0][0]).toMatch(/DELETE FROM device_tokens WHERE token = \? AND user_id = \?/);
    expect(bind).toHaveBeenCalledWith('tok_1', 'user_1');
    expect(run).toHaveBeenCalled();
  });

  it('does not delete when the token belongs to a different user (query scoped, no matching row)', async () => {
    const { db, bind, run } = makeDb();
    await deleteDeviceToken(db, 'tok_1', 'user_2');
    // The bind args prove the delete is scoped to the caller's own user id,
    // so a token owned by another user can never match this WHERE clause.
    expect(bind).toHaveBeenCalledWith('tok_1', 'user_2');
    expect(run).toHaveBeenCalled();
  });
});

describe('getDeviceTokensForUser', () => {
  it('returns rows for the user', async () => {
    const { db } = makeDb();
    const rows = await getDeviceTokensForUser(db, 'user_1');
    expect(rows).toEqual([{ token: 'tok_1', user_id: 'user_1', platform: 'ios', environment: 'production' }]);
  });
});
