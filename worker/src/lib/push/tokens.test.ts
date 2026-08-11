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
  it('deletes by token', async () => {
    const { db, prepare, bind, run } = makeDb();
    await deleteDeviceToken(db, 'tok_1');
    expect(prepare.mock.calls[0][0]).toMatch(/DELETE FROM device_tokens WHERE token = \?/);
    expect(bind).toHaveBeenCalledWith('tok_1');
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
