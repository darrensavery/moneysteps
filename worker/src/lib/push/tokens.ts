export interface DeviceToken {
  token: string;
  user_id: string;
  platform: 'ios' | 'android';
  environment: 'sandbox' | 'production';
}

export async function upsertDeviceToken(
  db: D1Database,
  args: { token: string; user_id: string; platform: 'ios' | 'android'; environment: 'sandbox' | 'production' },
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO device_tokens (token, user_id, platform, environment, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(token) DO UPDATE SET
        user_id = excluded.user_id,
        platform = excluded.platform,
        environment = excluded.environment,
        updated_at = unixepoch()
    `)
    .bind(args.token, args.user_id, args.platform, args.environment)
    .run();
}

export async function deleteDeviceToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
}

export async function getDeviceTokensForUser(db: D1Database, userId: string): Promise<DeviceToken[]> {
  const result = await db
    .prepare('SELECT token, user_id, platform, environment FROM device_tokens WHERE user_id = ?')
    .bind(userId)
    .all<DeviceToken>();
  return result.results ?? [];
}
