/**
 * Morechard — Cloudflare Worker API
 *
 * Public routes (no auth required):
 *   POST   /auth/register               Create parent account
 *   POST   /auth/login                  Email + password → JWT
 *   POST   /auth/magic-link             Request magic link email
 *   GET    /auth/verify                 Consume magic link → JWT
 *   POST   /auth/child/login            Child PIN → scoped JWT
 *   GET    /api/health                  Health check
 *
 * Authenticated — parent or child:
 *   GET    /auth/me                     Current user profile
 *   POST   /auth/logout                 Revoke session
 *
 * Authenticated — parent only:
 *   POST   /auth/child/set-pin          Set/reset child PIN
 *   PATCH  /api/child/:id/display-name  Rename a child
 *   GET    /api/child/:id/login-history Child's login history (last 50)
 *   POST   /api/ledger                  Create ledger entry
 *   GET    /api/ledger                  Query ledger
 *   POST   /api/ledger/:id/verify       Second parent verifies pending entry
 *   POST   /api/ledger/:id/raise-dispute Raise dispute with structured code
 *   POST   /api/ledger/:id/dispute      (legacy) Amicable-mode dispute
 *   GET    /api/export/json             GDPR portability export
 *   GET    /api/export/pdf              Court-ready HTML report
 *   POST   /api/governance/request      Request verify_mode change
 *   POST   /api/governance/:id/confirm  Second parent confirms
 *   POST   /api/governance/:id/reject   Second parent rejects
 *   POST   /api/governance/expire       Expire stale requests (cron)
 *   GET    /api/governance              Fetch governance log
 *
 * Authenticated — parent only (invite + registration):
 *   POST   /auth/invite/generate        Generate typed 6-char invite code
 *   POST   /auth/child/add              Add child + auto-generate child invite code
 *   POST   /auth/registration/save-step Persist mid-flow registration state
 *
 * Public — invite redemption:
 *   POST   /auth/invite/peek            Validate code without redeeming → { role }
 *   POST   /auth/invite/redeem          Redeem invite code (child or co-parent)
 */

import * as Sentry from '@sentry/cloudflare';
import { Env } from './types.js';
import {
  handleChoreCreate, handleChoreList, handleChoreUpdate,
  handleChoreArchive, handleChoreRestore, handleChoreSubmit,
} from './routes/chores.js';
import {
  handleCompletionList, handleCompletionCount, handleCompletionHistory,
  handleCompletionApprove, handleCompletionRevise,
  handleCompletionRate, handleApproveAll,
} from './routes/completions.js';
import { handleProofUpload, handleProofGet } from './routes/proof.js';
import {
  handleGoalList, handleGoalCreate, handleGoalUpdate,
  handleGoalDelete, handleGoalReorder,
  handleGoalPurchase, handleGoalContribute,
} from './routes/goals.js';
import {
  handleSpendingCreate, handleSpendingList,
  handlePayoutCreate, handlePayoutList,
  handleBonusCreate, handleBonusList,
  handleSubscriptionCreate, handleSubscriptionList,
  handleSubscriptionUpdate, handleSubscriptionCancel,
  handleBalance,
} from './routes/finance.js';
import { handlePlanList, handlePlanCreate, handlePlanDelete } from './routes/plans.js';
import {
  handleSuggestionCreate, handleSuggestionList,
  handleSuggestionApprove, handleSuggestionReject,
} from './routes/suggestions.js';
import {
  handleSettingsGet, handleSettingsUpdate,
  handleFamilyGet, handleFamilyUpdate,
  handleChildrenList,
  handleAccountLock, handleAccountUnlock,
  handleParentMessageSet, handleParentMessageGet,
  handleChildGrowthGet, handleChildGrowthUpdate,
  handleChildRename, handleChildLoginHistory,
} from './routes/settings.js';
import { handleLedgerPost, handleLedgerGet, handleLedgerDispute } from './routes/ledger.js';
import { handleLedgerVerify } from './routes/verify.js';
import { handleRaiseDispute } from './routes/raise-dispute.js';
import { handleExportJson, handleExportPdf } from './routes/export.js';
import {
  handleGovernanceRequest,
  handleGovernanceConfirm,
  handleGovernanceReject,
  handleGovernanceExpire,
  handleGovernanceGet,
} from './routes/governance.js';
import {
  handleCreateFamily,
  handleRegister,
  handleLogin,
  handleMagicLinkRequest,
  handleMagicLinkVerify,
  handleChildLogin,
  handleSetChildPin,
  handleLogout,
  handleMe,
  handleMePatch,
  handleFamilyLeads,
  handleLeaveFamily,
  handleDeleteFamily,
  handlePinSet,
  handleVerifyPin,
  handleGetSessions,
  handleRevokeSession,
  handleRevokeOtherSessions,
  handleGoogleAuth,
  handleGoogleCallback,
  handleSltExchange,
} from './routes/auth.js';
import { requireAuth, requireRole, requireFamilyMatch } from './lib/middleware.js';
import { checkTrialStatus, getTrialStatus } from './lib/trial.js';
import { handleCreateCheckout, handleStripeWebhook } from './routes/stripe.js';
import { handleExchange } from './routes/exchange.js';
import {
  handleGenerateInvite,
  handlePeekInvite,
  handleRedeemInvite,
  handleAddChild,
  handleSaveRegistrationStep,
} from './routes/invite.js';
import { handleInsights } from './routes/insights.js';
import { handleChildChat } from './routes/chat.js';
import { handleChatHistory } from './routes/chat-history.js';
import { handleChatModules } from './routes/chat-modules.js';
import { json, error } from './lib/response.js';
import { JwtPayload } from './lib/jwt.js';

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: 'https://5c98bed7630910cc4fd178677dda8b33@o4511158328295424.ingest.de.sentry.io/4511158333997136',
    tracesSampleRate: 1.0,
  }),
  {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    let response: Response;
    try {
      response = await route(request, env, method, path);
    } catch (err) {
      console.error(err);
      Sentry.captureException(err);
      response = error('Internal server error', 500);
    }

    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // ── 1. Expire stale governance requests ────────────────────
    await env.DB
      .prepare(`UPDATE family_governance_log SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`)
      .bind(now).run();

    // ── 2. Weekly allowance payday sweep ───────────────────────
    // Runs every Saturday. For each child with allowance_amount > 0,
    // check if they have already been paid this week (payday_log UNIQUE
    // constraint is the idempotency key — safe on cron retry).
    await runPaydaySweep(env, now);

    // ── 3. Clean up expired SLT tokens and unblocked IP attempts ──
    await env.DB.prepare('DELETE FROM slt_tokens WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM slt_attempts WHERE blocked_until IS NOT NULL AND blocked_until < ?').bind(now).run();
  },
} satisfies ExportedHandler<Env>,
);

// ----------------------------------------------------------------
// ISO week number helper (1–53)
// ----------------------------------------------------------------
function getIsoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ----------------------------------------------------------------
// Payday sweep — called from scheduled() every Saturday
// ----------------------------------------------------------------
async function runPaydaySweep(env: Env, nowEpoch: number): Promise<void> {
  // Derive ISO week_start (Monday of current week) from nowEpoch
  const d = new Date(nowEpoch * 1000);
  const dayOfWeek = d.getUTCDay(); // 0=Sun … 6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - daysToMonday);
  const weekStart = monday.toISOString().slice(0, 10); // YYYY-MM-DD

  // Fetch all children eligible for an allowance payment this run.
  // Skip earnings_mode = 'CHORES' (task-based only — no automatic deposit).
  const { results: children } = await env.DB.prepare(`
    SELECT u.id AS child_id, u.family_id, u.display_name,
           u.allowance_amount, u.allowance_frequency, f.currency, f.verify_mode
    FROM users u
    JOIN family_roles fr ON fr.user_id = u.id AND fr.role = 'child'
    JOIN families f ON f.id = u.family_id
    WHERE u.allowance_amount > 0
      AND u.earnings_mode IN ('ALLOWANCE', 'HYBRID')
  `).all<{
    child_id: string; family_id: string; display_name: string;
    allowance_amount: number; allowance_frequency: string;
    currency: string; verify_mode: string;
  }>();

  for (const child of children) {
    // Frequency gate — BI_WEEKLY fires on even ISO week numbers; MONTHLY on week 1 of month
    if (child.allowance_frequency === 'BI_WEEKLY') {
      const isoWeek = getIsoWeekNumber(d);
      if (isoWeek % 2 !== 0) continue;
    } else if (child.allowance_frequency === 'MONTHLY') {
      // Only pay on the first Saturday of the month (day-of-month <= 7)
      if (d.getUTCDate() > 7) continue;
    }

    // Idempotency check — skip if already paid this week
    const alreadyPaid = await env.DB
      .prepare('SELECT id FROM payday_log WHERE child_id = ? AND week_start = ?')
      .bind(child.child_id, weekStart)
      .first();
    if (alreadyPaid) continue;

    // Compute chain hash for new ledger row
    const { computeRecordHash, GENESIS_HASH } = await import('./lib/hash.js');

    const prevRow = await env.DB
      .prepare('SELECT id, record_hash FROM ledger WHERE family_id = ? ORDER BY id DESC LIMIT 1')
      .bind(child.family_id)
      .first<{ id: number; record_hash: string }>();

    const previousHash = prevRow?.record_hash ?? GENESIS_HASH;

    const maxRow = await env.DB
      .prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM ledger WHERE family_id = ?')
      .bind(child.family_id)
      .first<{ max_id: number }>();

    const newId = (maxRow?.max_id ?? 0) + 1;
    const verificationStatus = child.verify_mode === 'amicable' ? 'verified_auto' : 'verified_manual';

    const recordHash = await computeRecordHash(
      newId, child.family_id, child.child_id,
      child.allowance_amount, child.currency, 'credit', previousHash,
    );

    // Atomic batch: ledger row + payday_log row (idempotency key)
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ledger
          (id, family_id, child_id, entry_type, amount, currency,
           description, verification_status, previous_hash, record_hash, ip_address)
        VALUES (?,?,?,'credit',?,?,?,?,?,?,'cron')
      `).bind(
        newId, child.family_id, child.child_id,
        child.allowance_amount, child.currency,
        `Weekly allowance — w/c ${weekStart}`,
        verificationStatus, previousHash, recordHash,
      ),
      env.DB.prepare(`
        INSERT OR IGNORE INTO payday_log (family_id, child_id, week_start, ledger_id, paid_at)
        VALUES (?,?,?,?,?)
      `).bind(child.family_id, child.child_id, weekStart, newId, nowEpoch),
    ]);
  }
}

// ----------------------------------------------------------------
async function route(request: Request, env: Env, method: string, path: string): Promise<Response> {

  // ── Public ──────────────────────────────────────────────────
  if (path === '/api/health') return json({ ok: true });

  if (path === '/auth/exchange'      && method === 'POST') return handleExchange(request, env);
  if (path === '/auth/create-family' && method === 'POST') return handleCreateFamily(request, env);
  if (path === '/auth/register'      && method === 'POST') return handleRegister(request, env);
  if (path === '/auth/login'       && method === 'POST') return handleLogin(request, env);
  if (path === '/auth/magic-link'  && method === 'POST') return handleMagicLinkRequest(request, env);
  if ((path === '/api/auth/verify' || path === '/auth/verify') && method === 'GET') return handleMagicLinkVerify(request, env);
  if (path === '/auth/child/login'   && method === 'POST') return handleChildLogin(request, env);
  if (path === '/auth/invite/peek'   && method === 'POST') return handlePeekInvite(request, env);
  if (path === '/auth/invite/redeem' && method === 'POST') return handleRedeemInvite(request, env);
  if (path === '/auth/google'          && method === 'GET')  return handleGoogleAuth(request, env);
  if (path === '/auth/google/callback' && method === 'GET')  return handleGoogleCallback(request, env);
  if (path === '/auth/slt/exchange'    && method === 'POST') return handleSltExchange(request, env);

  // Stripe webhook — public but signature-verified internally
  if (path === '/api/stripe/webhook' && method === 'POST') return handleStripeWebhook(request, env);

  // ── All authenticated routes require a valid JWT ─────────────
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  // ── Authenticated — any role ──────────────────────────────────
  if (path === '/auth/me'     && method === 'GET')  return withAuth(request, auth, env, handleMe);
  if (path === '/auth/me'     && method === 'PATCH') return withAuth(request, auth, env, handleMePatch);
  if (path === '/auth/logout' && method === 'POST') return withAuth(request, auth, env, handleLogout);

  // Co-parent-aware account deletion — placed before trial check so expired-trial users can still delete
  if (path === '/auth/family/leads' && method === 'GET')    return withAuth(request, auth, env, handleFamilyLeads);
  if (path === '/auth/me/leave'     && method === 'DELETE') return withAuth(request, auth, env, handleLeaveFamily);
  if (path === '/auth/family'       && method === 'DELETE') return withAuth(request, auth, env, handleDeleteFamily);

  // Settings (any role — children can update their own avatar/theme)
  if (path === '/api/settings' && method === 'GET')   return withAuth(request, auth, env, handleSettingsGet);
  if (path === '/api/settings' && method === 'PATCH')  return withAuth(request, auth, env, handleSettingsUpdate);

  // Family info (read — any authenticated role)
  if (path === '/api/family'   && method === 'GET')   return withAuth(request, auth, env, handleFamilyGet);
  if (path === '/api/children' && method === 'GET')   return withAuth(request, auth, env, handleChildrenList);

  // Child growth path (parent only)
  const childGrowthMatch = path.match(/^\/api\/child-growth\/([^/]+)$/);
  if (childGrowthMatch && method === 'GET')   return withAuth(request, auth, env, (req, e) => handleChildGrowthGet(req, e, childGrowthMatch[1]));
  if (childGrowthMatch && method === 'PATCH') return withAuth(request, auth, env, (req, e) => handleChildGrowthUpdate(req, e, childGrowthMatch[1]));

  // Child rename + login history (parent only — placed before trial gate intentionally)
  const childIdMatch = path.match(/^\/api\/child\/([^/]+)\/display-name$/);
  if (childIdMatch && method === 'PATCH') return withAuth(request, auth, env, (req, e) => handleChildRename(req, e, childIdMatch[1]));

  const childHistoryMatch = path.match(/^\/api\/child\/([^/]+)\/login-history$/);
  if (childHistoryMatch && method === 'GET') return withAuth(request, auth, env, (req, e) => handleChildLoginHistory(req, e, childHistoryMatch[1]));

  // Chores — children can list & submit
  if (path === '/api/chores' && method === 'GET')     return withAuth(request, auth, env, handleChoreList);
  const choreSubmitMatch = path.match(/^\/api\/chores\/([^/]+)\/submit$/);
  if (choreSubmitMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleChoreSubmit(req, e, choreSubmitMatch[1]));

  // Completions — children can list their own & rate
  if (path === '/api/completions'         && method === 'GET')  return withAuth(request, auth, env, handleCompletionList);
  if (path === '/api/completions/count'   && method === 'GET')  return withAuth(request, auth, env, handleCompletionCount);
  if (path === '/api/completions/history' && method === 'GET')  return withAuth(request, auth, env, handleCompletionHistory);
  const compRateMatch = path.match(/^\/api\/completions\/([^/]+)\/rate$/);
  if (compRateMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleCompletionRate(req, e, compRateMatch[1]));
  // Proof upload/view — child uploads, both roles view
  const compProofMatch = path.match(/^\/api\/completions\/([^/]+)\/proof$/);
  if (compProofMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleProofUpload(req, e, compProofMatch[1]));
  if (compProofMatch && method === 'GET')  return withAuth(request, auth, env, (req, e) => handleProofGet(req, e, compProofMatch[1]));

  // Goals — children & parents can read; parents can write
  if (path === '/api/goals' && method === 'GET')      return withAuth(request, auth, env, handleGoalList);

  // Plans — both roles
  if (path === '/api/plans' && method === 'GET')      return withAuth(request, auth, env, handlePlanList);
  if (path === '/api/plans' && method === 'POST')     return withAuth(request, auth, env, handlePlanCreate);
  const planDeleteMatch = path.match(/^\/api\/plans\/([^/]+)$/);
  if (planDeleteMatch && method === 'DELETE') return withAuth(request, auth, env, (req, e) => handlePlanDelete(req, e, planDeleteMatch[1]));

  // Suggestions — children create, both roles can read
  if (path === '/api/suggestions' && method === 'GET')  return withAuth(request, auth, env, handleSuggestionList);
  if (path === '/api/suggestions' && method === 'POST') return withAuth(request, auth, env, handleSuggestionCreate);

  // Balance — any role
  if (path === '/api/balance'   && method === 'GET')  return withAuth(request, auth, env, handleBalance);

  // Insights — parent or child (child sees own data only, enforced in handler)
  if (path === '/api/insights'  && method === 'GET')  return withAuth(request, auth, env, handleInsights);

  // Chat — child mentor (role check enforced in handler)
  if (path === '/api/chat' && method === 'POST') return withAuth(request, auth, env, (req, e) => handleChildChat(req, e));
  if (path === '/api/chat/history' && method === 'GET') return withAuth(request, auth, env, handleChatHistory);
  if (path === '/api/chat/modules' && method === 'GET') return withAuth(request, auth, env, handleChatModules);

  // Spending — child logs, both read
  if (path === '/api/spending' && method === 'GET')   return withAuth(request, auth, env, handleSpendingList);
  if (path === '/api/spending' && method === 'POST')  return withAuth(request, auth, env, handleSpendingCreate);

  // Payouts — both read
  if (path === '/api/payouts'  && method === 'GET')   return withAuth(request, auth, env, handlePayoutList);

  // Subscriptions — both read
  if (path === '/api/subscriptions' && method === 'GET') return withAuth(request, auth, env, handleSubscriptionList);

  // Parent message — child reads
  if (path === '/api/parent-message' && method === 'GET') return withAuth(request, auth, env, handleParentMessageGet);

  // ── Trial / paywall gate (all authenticated routes) ──────────
  const trialBlock = await checkTrialStatus(request, env, auth.family_id);
  if (trialBlock) return trialBlock;

  // ── Trial status endpoint (any role) ─────────────────────────
  if (path === '/api/trial/status' && method === 'GET') {
    return json(await getTrialStatus(env, auth.family_id));
  }

  // ── Parent-only routes ────────────────────────────────────────
  const parentCheck = requireRole(auth, 'parent');
  if (parentCheck) return parentCheck;

  // Child PIN management
  if (path === '/auth/child/set-pin' && method === 'POST') {
    return withAuth(request, auth, env, handleSetChildPin);
  }

  // Family write (parent only)
  if (path === '/api/family' && method === 'PATCH') return withAuth(request, auth, env, handleFamilyUpdate);

  // Chores write (parent only)
  if (path === '/api/chores' && method === 'POST')  return withAuth(request, auth, env, handleChoreCreate);
  const choreIdMatch = path.match(/^\/api\/chores\/([^/]+)$/);
  if (choreIdMatch && method === 'PATCH')  return withAuth(request, auth, env, (req, e) => handleChoreUpdate(req, e, choreIdMatch[1]));
  if (choreIdMatch && method === 'DELETE') return withAuth(request, auth, env, (req, e) => handleChoreArchive(req, e, choreIdMatch[1]));
  const choreRestoreMatch = path.match(/^\/api\/chores\/([^/]+)\/restore$/);
  if (choreRestoreMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleChoreRestore(req, e, choreRestoreMatch[1]));

  // Completions — parent approval
  const compApproveMatch = path.match(/^\/api\/completions\/([^/]+)\/approve$/);
  if (compApproveMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleCompletionApprove(req, e, compApproveMatch[1]));
  const compReviseMatch = path.match(/^\/api\/completions\/([^/]+)\/revise$/);
  if (compReviseMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleCompletionRevise(req, e, compReviseMatch[1]));
  if (path === '/api/completions/approve-all' && method === 'POST') return withAuth(request, auth, env, handleApproveAll);

  // Goals write (parent only)
  if (path === '/api/goals' && method === 'POST') return withAuth(request, auth, env, handleGoalCreate);
  const goalIdMatch = path.match(/^\/api\/goals\/([^/]+)$/);
  if (goalIdMatch && method === 'PATCH')  return withAuth(request, auth, env, (req, e) => handleGoalUpdate(req, e, goalIdMatch[1]));
  if (goalIdMatch && method === 'DELETE') return withAuth(request, auth, env, (req, e) => handleGoalDelete(req, e, goalIdMatch[1]));
  const goalReorderMatch = path.match(/^\/api\/goals\/([^/]+)\/reorder$/);
  if (goalReorderMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleGoalReorder(req, e, goalReorderMatch[1]));
  const goalPurchaseMatch = path.match(/^\/api\/goals\/([^/]+)\/purchase$/);
  if (goalPurchaseMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleGoalPurchase(req, e, goalPurchaseMatch[1]));
  const goalContributeMatch = path.match(/^\/api\/goals\/([^/]+)\/contribute$/);
  if (goalContributeMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleGoalContribute(req, e, goalContributeMatch[1]));

  // Finance write — parent only
  if (path === '/api/payouts' && method === 'POST')        return withAuth(request, auth, env, handlePayoutCreate);
  if (path === '/api/bonus'   && method === 'POST')        return withAuth(request, auth, env, handleBonusCreate);
  if (path === '/api/bonus'   && method === 'GET')         return withAuth(request, auth, env, handleBonusList);
  if (path === '/api/subscriptions' && method === 'POST')  return withAuth(request, auth, env, handleSubscriptionCreate);
  const subIdMatch = path.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (subIdMatch && method === 'PATCH')  return withAuth(request, auth, env, (req, e) => handleSubscriptionUpdate(req, e, subIdMatch[1]));
  if (subIdMatch && method === 'DELETE') return withAuth(request, auth, env, (req, e) => handleSubscriptionCancel(req, e, subIdMatch[1]));

  // Suggestions — parent approves/rejects
  const sugApproveMatch = path.match(/^\/api\/suggestions\/([^/]+)\/approve$/);
  if (sugApproveMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleSuggestionApprove(req, e, sugApproveMatch[1]));
  const sugRejectMatch = path.match(/^\/api\/suggestions\/([^/]+)\/reject$/);
  if (sugRejectMatch && method === 'POST') return withAuth(request, auth, env, (req, e) => handleSuggestionReject(req, e, sugRejectMatch[1]));

  // Account lock/unlock
  if (path === '/api/account-lock' && method === 'POST') return withAuth(request, auth, env, handleAccountLock);
  const unlockMatch = path.match(/^\/api\/account-lock\/([^/]+)$/);
  if (unlockMatch && method === 'DELETE') return withAuth(request, auth, env, (req, e) => handleAccountUnlock(req, e, unlockMatch[1]));

  // Parent message
  if (path === '/api/parent-message' && method === 'POST') return withAuth(request, auth, env, handleParentMessageSet);

  // Invite code generation + child onboarding + registration persistence
  if (path === '/auth/invite/generate'        && method === 'POST') return withAuth(request, auth, env, handleGenerateInvite);
  if (path === '/auth/child/add'               && method === 'POST') return withAuth(request, auth, env, handleAddChild);
  if (path === '/auth/registration/save-step'  && method === 'POST') return withAuth(request, auth, env, handleSaveRegistrationStep);

  // Ledger
  if (path === '/api/ledger') {
    if (method === 'POST') {
      const famCheck = await checkFamilyFromBody(request, auth, env);
      if (famCheck) return famCheck;
      return handleLedgerPost(request, env);
    }
    if (method === 'GET') {
      const famCheck = requireFamilyMatch(auth, new URL(request.url).searchParams.get('family_id') ?? '');
      if (famCheck) return famCheck;
      return handleLedgerGet(request, env);
    }
  }

  const verifyMatch = path.match(/^\/api\/ledger\/(\d+)\/verify$/);
  if (verifyMatch && method === 'POST') return handleLedgerVerify(request, env, verifyMatch[1]);

  const raiseDisputeMatch = path.match(/^\/api\/ledger\/(\d+)\/raise-dispute$/);
  if (raiseDisputeMatch && method === 'POST') return handleRaiseDispute(request, env, raiseDisputeMatch[1]);

  const disputeMatch = path.match(/^\/api\/ledger\/(\d+)\/dispute$/);
  if (disputeMatch && method === 'POST') return handleLedgerDispute(request, env, disputeMatch[1]);

  // Export
  if (path === '/api/export/json' && method === 'GET') {
    const famCheck = requireFamilyMatch(auth, new URL(request.url).searchParams.get('family_id') ?? '');
    if (famCheck) return famCheck;
    return handleExportJson(request, env);
  }
  if (path === '/api/export/pdf' && method === 'GET') {
    const famCheck = requireFamilyMatch(auth, new URL(request.url).searchParams.get('family_id') ?? '');
    if (famCheck) return famCheck;
    return handleExportPdf(request, env);
  }

  // Stripe checkout (parent only, post-auth)
  if (path === '/api/stripe/create-checkout' && method === 'POST') {
    return handleCreateCheckout(request, env, auth);
  }

  // Governance
  if (path === '/api/governance/request' && method === 'POST') return handleGovernanceRequest(request, env);
  if (path === '/api/governance/expire'  && method === 'POST') return handleGovernanceExpire(request, env);
  if (path === '/api/governance'         && method === 'GET')  return handleGovernanceGet(request, env);

  const govActionMatch = path.match(/^\/api\/governance\/(\d+)\/(confirm|reject)$/);
  if (govActionMatch && method === 'POST') {
    const [, id, action] = govActionMatch;
    if (action === 'confirm') return handleGovernanceConfirm(request, env, id);
    if (action === 'reject')  return handleGovernanceReject(request, env, id);
  }

  // ── Security / PIN ────────────────────────────────────────────────
  if (method === 'POST' && path === '/auth/pin/set')
    return withAuth(request, auth, env, handlePinSet);
  // Same handler — distinct route name lets the frontend show different copy ("Forgot PIN?")
  if (method === 'POST' && path === '/auth/pin/reset-with-password')
    return withAuth(request, auth, env, handlePinSet);
  if (method === 'POST' && path === '/auth/verify-pin')
    return withAuth(request, auth, env, handleVerifyPin);

  // ── Sessions ──────────────────────────────────────────────────────
  if (method === 'GET' && path === '/auth/sessions')
    return withAuth(request, auth, env, handleGetSessions);
  if (method === 'DELETE' && path === '/auth/sessions' && new URL(request.url).searchParams.get('others') === 'true')
    return withAuth(request, auth, env, handleRevokeOtherSessions);
  if (method === 'DELETE' && path.startsWith('/auth/sessions/'))
    return withAuth(request, auth, env, handleRevokeSession);

  return error('Not found', 404);
}

// ----------------------------------------------------------------
// Inject auth payload into request for use by handlers
// ----------------------------------------------------------------
function withAuth(
  request: Request,
  auth: JwtPayload,
  env: Env,
  handler: (req: Request, env: Env) => Promise<Response>,
): Promise<Response> {
  const augmented = Object.assign(request, { auth });
  return handler(augmented, env);
}

// Peek at body's family_id to enforce family match — then re-inject body
// so the downstream handler can still read it.
async function checkFamilyFromBody(
  request: Request,
  auth: JwtPayload,
  env: Env,
): Promise<Response | null> {
  // We need to read the body to extract family_id, but body can only be
  // consumed once. Clone it first.
  const clone = request.clone();
  try {
    const body = await clone.json() as Record<string, unknown>;
    const family_id = body['family_id'];
    if (typeof family_id === 'string') {
      return requireFamilyMatch(auth, family_id);
    }
  } catch { /* invalid JSON — let the route handler return the error */ }
  return null;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
