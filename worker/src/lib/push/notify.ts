// ----------------------------------------------------------------
// Fire-and-forget push notification helpers.
//
// Every push trigger in the app runs inside ctx.waitUntil(). sendPushNotification
// itself never throws, but the *data gathering* around it (pending-count queries,
// display_name lookup, family_roles parent lookup) all hit D1 and can reject —
// producing an unhandled rejection inside waitUntil on the app's hottest paths.
//
// These two helpers own that data gathering and wrap the whole thing in a
// try/catch, so a call site can safely do:
//
//   ctx.waitUntil(notifyChild(env, childId, familyId, { ... }))
//
// with zero chance of an unhandled rejection.
// ----------------------------------------------------------------

import type { Env } from '../../types.js';
import { sendPushNotification } from './send.js';
import { getChildPendingCount, getParentPendingCount } from './pendingCount.js';

export interface NotifyPayload {
  title: string;
  body: string;
  route: string;
}

/** Notify one child. Computes the child's badge count internally. Never throws. */
export async function notifyChild(
  env: Env,
  childId: string,
  familyId: string,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const badgeCount = await getChildPendingCount(env.DB, familyId, childId);
    await sendPushNotification(env, childId, { ...payload, badgeCount });
  } catch (err) {
    console.error('[push] notifyChild failed:', err);
  }
}

/** Payload for notifyParents. `body` may be a builder function, in which case
 *  `actorChildId`'s display name is looked up (inside the try/catch) and passed
 *  to it — used by the "X finished Y" / "X wants to give £Z" notifications. */
export type NotifyParentsPayload =
  | NotifyPayload
  | { title: string; route: string; body: (childName: string) => string; actorChildId: string };

/** Notify every parent in a family. Owns the parent lookup + badge count.
 *  Never throws. */
export async function notifyParents(
  env: Env,
  familyId: string,
  payload: NotifyParentsPayload,
): Promise<void> {
  try {
    let body: string;
    if (typeof payload.body === 'function') {
      const childRow = await env.DB
        .prepare('SELECT display_name FROM users WHERE id = ?')
        .bind((payload as { actorChildId: string }).actorChildId)
        .first<{ display_name: string }>();
      body = payload.body(childRow?.display_name ?? 'Your child');
    } else {
      body = payload.body;
    }

    // Note: 'role' lives on family_roles, not users — users has no role column.
    const parents = await env.DB
      .prepare(`SELECT u.id FROM users u JOIN family_roles fr ON fr.user_id = u.id
                WHERE fr.family_id = ? AND fr.role = 'parent'`)
      .bind(familyId)
      .all<{ id: string }>();

    const badgeCount = await getParentPendingCount(env.DB, familyId);

    await Promise.allSettled(
      (parents.results ?? []).map(p =>
        sendPushNotification(env, p.id, { title: payload.title, body, route: payload.route, badgeCount }),
      ),
    );
  } catch (err) {
    console.error('[push] notifyParents failed:', err);
  }
}
