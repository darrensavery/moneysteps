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
 *   GET    /api/market-rates            List canonical chores with locale-aware medians
 *   POST   /api/market-rates/suggest    Child suggests a chore (writes to suggestions table)
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
 *   POST   /api/shared-expenses           Log a shared expense
 *   GET    /api/shared-expenses           List shared expenses (non-deleted)
 *   POST   /api/shared-expenses/:id/approve  Approve pending expense
 *   POST   /api/shared-expenses/:id/reject   Reject pending expense
 *   DELETE /api/shared-expenses/:id       Soft-delete (pending/rejected only)
 *   POST   /api/shared-expenses/reconcile Monthly settlement reconcile
 *   POST   /api/shared-expenses/:id/receipt    Upload receipt
 *   GET    /api/shared-expenses/:id/receipt    Get presigned receipt URL
 *   DELETE /api/shared-expenses/:id/receipt    Delete receipt (48h window)
 *   POST   /api/shared-expenses/:id/void       Void expense (+ optional replacement)
 *   PATCH  /api/family/settings           Update threshold + split defaults
 *
 * Authenticated — parent only (invite + registration):
 *   POST   /auth/invite/generate        Generate typed 6-char invite code
 *   POST   /auth/child/add              Add child + auto-generate child invite code
 *   POST   /auth/registration/save-step Persist mid-flow registration state
 *
 * Authenticated — parent only (referrals):
 *   GET    /api/referrals/me            Return caller's referral code + shareable URL
 *   GET    /api/referrals/stats         Click + conversion counts for caller's referral code
 *
 * Public (no auth):
 *   GET    /api/market-rates/cron       CRON health check — reports market_rates row count
 *   POST   /api/referrals/click         Record a referral link click
 *   POST   /api/public/interest         Register pre-launch interest → Brevo list 4
 *   GET    /api/verify/:hash            Public chain-head hash verification (no PII returned)
 *   GET    /api/support-agent/review/:id/approve  One-tap approval link (email-only auth via token)
 *
 * Public — invite redemption:
 *   POST   /auth/invite/peek            Validate code without redeeming → { role }
 *   POST   /auth/invite/redeem          Redeem invite code (child or co-parent)
 */

import * as Sentry from '@sentry/cloudflare';
import { Env, IncidentQueueMessage } from './types.js';
import { processIncident } from './lib/agent/processIncident.js';
import {
  handleChoreCreate, handleChoreList, handleChoreUpdate,
  handleChoreArchive, handleChoreRestore, handleChoreSubmit, handleChoreClaim,
} from './routes/chores.js';
import {
  handleCompletionList, handleCompletionCount, handleCompletionHistory,
  handleCompletionApprove, handleCompletionRevise, handleCompletionReject,
  handleCompletionRate, handleApproveAll,
} from './routes/completions.js';
import {
  handleMarkPaid, handleMarkPaidBatch, handleUnpaidSummary,
  handleSetPaymentHandles,
} from './routes/payments.js';
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
  handleAccountLock, handleAccountUnlock, handleAccountLockStatusMe,
  handleParentMessageSet, handleParentMessageGet,
  handleChildGrowthGet, handleChildGrowthUpdate,
  handleChildRename, handleChildLoginHistory,
} from './routes/settings.js';
import { handleSetChildBirthDate } from './routes/childSettings.js';
import { handleLedgerPost, handleLedgerGet, handleLedgerDispute } from './routes/ledger.js';
import { handlePublicLedgerVerify } from './routes/ledger-verify-public.js';
import { handleLedgerVerify } from './routes/verify.js';
import { handleRaiseDispute } from './routes/raise-dispute.js';
import { handleExportJson, handleExportPdf, handleExportPrune, handleExportPruneCheck } from './routes/export.js';
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
  handleVerifyEmail,
  handleFamilyLeads,
  handleLeaveFamily,
  handleDeleteFamily,
  handleGetCoParents,
  handleRemoveCoParent,
  handlePinSet,
  handleVerifyPin,
  handleGetSessions,
  handleRevokeSession,
  handleRevokeOtherSessions,
  handleGoogleAuth,
  handleGoogleCallback,
  handleSltExchange,
} from './routes/auth.js';
import {
  handleWebauthnRegisterOptions, handleWebauthnRegisterVerify,
  handleWebauthnLoginOptions, handleWebauthnLoginVerify,
} from './routes/webauthn.js';
import { requireAuth, requireRole, requireFamilyMatch, requireCsrfHeader } from './lib/middleware.js';
import { getAuthCookie } from './lib/cookies.js';
import { requireAdmin, requireAdminBasicAuth } from './lib/adminAuth.js';
import { checkTrialStatus, getTrialStatus } from './lib/trial.js';
import { handleCreateCheckout, handleStripeWebhook, handleCancelPlan, handleShieldUpgradePrice } from './routes/stripe.js';
import {
  handleCreatePromoCode, handleListPromoCodes, handleGetPromoCode,
  handleListPromotionCandidates, handlePromotePromotionCandidate, handleDismissPromotionCandidate,
  handleGetAdminExchangeRates, handleUpdateExchangeRate,
} from './routes/admin.js';
import { handleListAgentReviewItems, handleDeclineAgentReviewItem, handleApproveAgentReviewItem, handleSendReplyAgentReviewItem } from './routes/agentReview.js';
import { handleApproveReviewItem } from './routes/agentApprove.js';
import { serveAdminUI } from './routes/admin-ui.js';
import {
  handleGenerateInvite,
  handlePeekInvite,
  handleRedeemInvite,
  handleAddChild,
  handleRegenerateChildInvite,
  handleSaveRegistrationStep,
} from './routes/invite.js';
import { handleInsights } from './routes/insights.js';
import { handleGetStreaks } from './routes/streaks.js';
import {
  handleDemoRegister,
  handleDemoEnter,
  handleDemoNotify,
  handleDemoActive,
} from './routes/demo.js';
import {
  handleMarketRateList,
  handleMarketRateSuggest,
  handleMarketRateCron,
} from './routes/market-rates.js';
import { runMarketRateAggregation } from './jobs/marketRateAggregation.js';
import { runSuggestionPromotion } from './jobs/suggestionPromotion.js';
import { runSoftDeletePurge, runLedgerPurge } from './jobs/familyPurge.js';
import { runDemoReset } from './cron/demo-reset.js';
import { runPassiveUnlockSweep } from './cron/passive-unlocks.js';
import { handleLabModules, handleLabActComplete } from './routes/lab.js';
import {
  handleReferralMe,
  handleReferralStats,
  handleReferralClick,
} from './routes/referrals.js';
import { handleConsentPost, handleConsentGet, handleAnalyticsConsentPost, handleAnalyticsEffectiveGet } from './routes/consent.js';
import { handlePublicInterest } from './routes/public-interest.js';
import { handleGetJars, handlePutJarConfig, handlePostJarMove, handleGetJarMovements } from './routes/jars.js';
import { handleGetChildNudges, handleDismissChildNudge, handleImpulseOutcome, runChildNudgeBackgroundChecks } from './routes/child-nudges.js';
import { handleRegisterDeviceToken, handleUnregisterDeviceToken } from './routes/push.js';
import { handleGetFamilyAudit } from './routes/family-audit.js';
import { handlePostGiveRequest, handleGetGiveRequests, handlePatchGiveRequest } from './routes/give-requests.js';
import { json, error } from './lib/response.js';
import { JwtPayload } from './lib/jwt.js';
import {
  handleCreateSharedExpense,
  handleListSharedExpenses,
  handleApproveSharedExpense,
  handleRejectSharedExpense,
  handleDeleteSharedExpense,
  handleReconcileSharedExpenses,
  handleUpdateFamilySettings,
} from './routes/sharedExpenses.js';
import { handleUploadReceipt, handleGetReceiptUrl, handleDeleteReceipt } from './routes/sharedExpenseReceipt.js';
import { handleVoidSharedExpense } from './routes/sharedExpenseVoid.js';
import {
  handleReviewOutcome,
  handleReviewFeedback,
  handleFeedbackDigest,
} from './routes/reviewPrompt.js'
import { handleDevRequest } from './routes/dev.js';
import { handlePostMentorChatMessage, handleGetMentorChatHistory } from './routes/mentorChat.js';
import {
  handleSentryWebhook,
  handleSupportAgentRequest, handleSupportAgentStripeWebhook,
} from './routes/supportAgentIngest.js';
import { pollZohoDeskTickets } from './lib/agent/zohoPoll.js';

const SENSITIVE_FIELDS = new Set(['password', 'pin', 'token', 'secret', 'authorization', 'jwt', 'api_key', 'apikey']);

// beforeSend only receives error events (not transactions), so type it as
// ErrorEvent to satisfy CloudflareOptions['beforeSend'].
function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (SENSITIVE_FIELDS.has(key.toLowerCase())) delete event.extra[key];
    }
  }
  return event;
}

// Shared Sentry init options — used for both the fetch/scheduled instrumentation
// below and the queue handler (kept in the same handler object so withSentry's
// internal instrumentExportedHandlerQueue() picks it up automatically; see the
// note above the `queue` method).
const sentryOptions = (env: Env) => ({
  dsn: 'https://5c98bed7630910cc4fd178677dda8b33@o4511158328295424.ingest.de.sentry.io/4511158333997136',
  tracesSampleRate: 0.1,
  beforeSend: scrubSentryEvent,
});

export default Sentry.withSentry<Env, IncidentQueueMessage>(
  sentryOptions,
  {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url    = new URL(request.url);
      const path   = url.pathname;
      const method = request.method.toUpperCase();

      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      let response: Response;
      try {
        response = await route(request, env, ctx, method, path);
      } catch (err) {
        // D1 Durable Object reset — transient platform error, not a code bug.
        // Return 503 so clients can retry; suppress from Sentry to avoid noise.
        if (err instanceof Error && err.message.includes('D1 DB storage operation exceeded timeout')) {
          response = new Response(
            JSON.stringify({ error: 'Database temporarily unavailable — please retry' }),
            { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' } },
          );
        } else {
          console.error(err);
          Sentry.captureException(err);
          response = error('Internal server error', 500);
        }
      }

      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
      // The admin HTML panel needs its own CSP (inline script, Google Fonts,
      // same-origin fetch) — don't clobber it with the JSON-API default-src 'none'.
      const isHtml = (headers.get('Content-Type') ?? '').includes('text/html');
      for (const [k, v] of Object.entries(securityHeaders())) {
        if (isHtml && k === 'Content-Security-Policy') continue;
        headers.set(k, v);
      }
      if (isHtml && !headers.has('Content-Security-Policy')) {
        headers.set(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        );
      }
      return new Response(response.body, { status: response.status, headers });
    },

    async scheduled(event: ScheduledController, env: Env): Promise<void> {
      const now = Math.floor(Date.now() / 1000);

      const runScheduledJobs = async (): Promise<void> => {
        // ── 1. Expire stale governance requests ────────────────────
        await env.DB
          .prepare(`UPDATE family_governance_log SET status = 'expired' WHERE status = 'pending' AND expires_at < ?`)
          .bind(now).run();

        // ── 2. Weekly allowance payday sweep ───────────────────────
        // For each child with allowance_amount > 0, check if they have
        // already been paid this week (payday_log UNIQUE constraint is the
        // idempotency key — safe on cron retry). Gated to the Saturday
        // 08:00 UTC tick ("0 8 * * 6" in wrangler.toml) — the function has
        // no internal day gate, so leaving this ungated meant a full
        // all-families child scan ran on every 5-minute tick (288x/day
        // instead of once a week), occasionally blowing the Sentry
        // "worker-scheduled-heartbeat" monitor's 5-minute maxRuntime as
        // family count grew and causing intermittent missed check-ins.
        {
          const d = new Date(now * 1000);
          if (d.getUTCDay() === 6 && d.getUTCHours() === 8) {
            await runPaydaySweep(env, now);
          }
        }

        // ── 3. Clean up expired SLT tokens and unblocked IP attempts ──
        await env.DB.prepare('DELETE FROM slt_tokens WHERE expires_at < ?').bind(now).run();
        await env.DB.prepare('DELETE FROM slt_attempts WHERE blocked_until IS NOT NULL AND blocked_until < ?').bind(now).run();

        // ── 4. Weekly market rate aggregation ──────────────────────
        await runMarketRateAggregation(env);

        // ── 4b. Weekly suggestion-promotion sweep ──────────────────
        // Clusters novel child suggestions, parks any that clear the distinct-family
        // threshold as pending candidates, and emails the operator a review digest.
        // Gated to the Monday 03:00 UTC tick so it (and its email) runs once a week.
        {
          const d = new Date(now * 1000);
          if (d.getUTCDay() === 1 && d.getUTCHours() === 3) {
            await runSuggestionPromotion(env);
          }
        }

        // ── 6. Nightly demo reset (Thomson family) ─────────────────
        await runDemoReset(env);

        // ── 7. Learning Lab passive-unlock sweep ───────────────────
        // Re-evaluates inactivity/balance/streak unlock conditions for every active
        // child, so triggers that depend on the absence of activity (e.g. M14
        // Inflation, 21 days with no transactions) fire even when the app is closed.
        // evaluatePassive is idempotent. Gated to the 00:00 UTC tick so this per-child
        // sweep runs once daily rather than on every cron tick.
        if (new Date(now * 1000).getUTCHours() === 0) {
          await runPassiveUnlockSweep(env);
        }

        // ── 8. Review feedback email digest ────────────────────────
        if (new Date(now * 1000).getUTCHours() === 7) {
          await handleFeedbackDigest(env);
        }

        // ── 9. Child nudge background checks (Sunday 20:00 UTC) ────
        // Pattern-based nudges: low consistency, spend-heavy, goal at risk,
        // give jar stagnant, Pillar 5 (high balance + no giving), etc.
        {
          const d = new Date(now * 1000);
          if (d.getUTCDay() === 0 && d.getUTCHours() === 20) {
            await runChildNudgeBackgroundChecks(env);
          }
        }

        // ── 10. Family data purge — two-stage GDPR retention enforcement ─
        //
        // Stage 1 (daily): hard-delete operational data for families whose 30-day
        // soft-delete window has closed. Ledger rows are kept as pseudonymised
        // personal data (Art. 6(1)(f), LIA-3). Families row is reduced to a
        // tombstone (id + deleted_at) to gate Stage 2.
        //
        // Stage 2 (daily): hard-delete pseudonymised ledger rows and tombstones
        // for families deleted more than 7 years ago (UK Limitation Act 1980,
        // civil-claims window — see docs/governance/lia/lia.md LIA-3).
        await runSoftDeletePurge(env, now);
        await runLedgerPurge(env, now);

        // ── 11. Zoho Desk ticket poll (support agent ingestion) ────
        // Runs every 5-minute tick only — the other cron entries fire on
        // this same handler at daily/weekly cadence, so gate on
        // event.cron to avoid polling on every tick.
        if (event.cron === '*/5 * * * *') {
          await pollZohoDeskTickets(env);
        }
      };

      // Sentry Cron Monitor "canary": the 5-minute tick runs this same
      // function body, and item 11 (the Zoho poll) is the last thing it
      // does — so a crash anywhere earlier in runScheduledJobs() (like the
      // ledger_old FK bug that silently broke every single tick for months)
      // means this tick never checks in "ok", and Sentry alerts on the
      // missed check-in rather than relying on someone noticing a captured
      // exception. Auto-instrumentation (upsert) creates/updates the
      // monitor definition from this config — no manual dashboard setup.
      if (event.cron === '*/5 * * * *') {
        await Sentry.withMonitor(
          'worker-scheduled-heartbeat',
          runScheduledJobs,
          {
            schedule: { type: 'crontab', value: '*/5 * * * *' },
            checkinMargin: 5,
            maxRuntime: 5,
            timezone: 'UTC',
          },
        );
      } else {
        await runScheduledJobs();
      }
    },

    // Kept in the same object passed to Sentry.withSentry() (rather than spread
    // in separately) so it gets real Sentry instrumentation. `@sentry/cloudflare`
    // does NOT publicly export a standalone `instrumentExportedHandlerQueue` —
    // its package.json `exports` map only exposes "." and "./request", so a deep
    // import of the internal instrumentQueue module isn't reachable from outside
    // the package. Instead, `withSentry()`'s own implementation
    // (build/esm/withSentry.js) already calls
    // `instrumentExportedHandlerQueue(handler, optionsCallback)` internally on
    // whatever handler object it's given — so simply including `queue` on the
    // object passed to `withSentry()` (as done here) is how it picks up the same
    // auto-instrumentation (span creation, isolated scope, captureException) that
    // `fetch`/`scheduled` get. The explicit `Sentry.captureException(err)` below
    // is kept as a defensive backup.
    async queue(batch: MessageBatch<IncidentQueueMessage>, env: Env): Promise<void> {
      for (const message of batch.messages) {
        try {
          await processIncident(env, message.body.incidentId);
          message.ack();
        } catch (err) {
          console.error('processIncident failed:', err);
          Sentry.captureException(err);
          await env.DB
            .prepare('UPDATE agent_incidents SET status = ? WHERE id = ?')
            .bind('failed', message.body.incidentId)
            .run()
            .catch(() => null); // best-effort — don't mask the original error
          message.retry();
        }
      }
    },
  } satisfies ExportedHandler<Env, IncidentQueueMessage>,
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

    // Verify the chain tip and derive the next row's id and previous hash.
    const { computeRecordHash, fetchAndVerifyChainTip } = await import('./lib/hash.js');

    let previousHash: string;
    let newLedgerId: number;
    try {
      ({ previousHash, newId: newLedgerId } = await fetchAndVerifyChainTip(env.DB, child.family_id));
    } catch (err) {
      console.error('[runPaydaySweep] chain integrity failure for family', child.family_id, err);
      continue; // skip this child; do not write a corrupt row
    }

    const verificationStatus = child.verify_mode === 'amicable' ? 'verified_auto' : 'verified_manual';

    const recordHash = await computeRecordHash(
      newLedgerId, child.family_id, child.child_id,
      child.allowance_amount, child.currency, 'credit', previousHash,
    );

    // Atomic batch: ledger row with explicit id (so the hash — which includes the id —
    // is always consistent with the row that lands in the DB) + payday_log idempotency row.
    // Using AUTOINCREMENT without a fixed id would let a concurrent Worker insert slip in
    // and push the auto-assigned id past newLedgerId, corrupting the hash chain silently.
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO ledger
          (id, family_id, child_id, entry_type, amount, currency,
           description, verification_status, previous_hash, record_hash, ip_address)
        VALUES (?,?,?,'credit',?,?,?,?,?,?,'cron')
      `).bind(
        newLedgerId,
        child.family_id, child.child_id,
        child.allowance_amount, child.currency,
        `Weekly allowance — w/c ${weekStart}`,
        verificationStatus, previousHash, recordHash,
      ),
      env.DB.prepare(`
        INSERT OR IGNORE INTO payday_log (family_id, child_id, week_start, ledger_id, paid_at)
        VALUES (?,?,?,?,?)
      `).bind(child.family_id, child.child_id, weekStart, newLedgerId, nowEpoch),
    ]);
  }
}

// ----------------------------------------------------------------
async function route(request: Request, env: Env, ctx: ExecutionContext, method: string, path: string): Promise<Response> {

  // ── Public ──────────────────────────────────────────────────
  // Touches D1 (not just process liveness) so an Uptime Monitor pinging
  // this catches a broken D1 binding/connectivity — a Worker can be up
  // and routing fine while every query fails.
  if (path === '/api/health') {
    try {
      await env.DB.prepare('SELECT 1').first();
      return json({ ok: true });
    } catch (err) {
      Sentry.captureException(err);
      return json({ ok: false, error: 'database unreachable' }, 503);
    }
  }

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
  if (path === '/auth/webauthn/login/options' && method === 'POST') return handleWebauthnLoginOptions(request, env);
  if (path === '/auth/webauthn/login/verify' && method === 'POST') return handleWebauthnLoginVerify(request, env);

  // Stripe webhook — public but signature-verified internally
  if (path === '/api/stripe/webhook' && method === 'POST') return handleStripeWebhook(request, env);

  // Sentry webhook — public but signature-verified internally
  if (path === '/api/support-agent/sentry-webhook' && method === 'POST') return handleSentryWebhook(request, env);

  // Stripe webhook — public but signature-verified internally (support-agent isolated endpoint)
  if (path === '/api/support-agent/stripe-webhook' && method === 'POST') return handleSupportAgentStripeWebhook(request, env);

  // Admin — self-contained browser panel. Page load itself is gated by HTTP
  // Basic Auth (browser-native prompt); the panel's own JS then uses
  // X-Admin-Key for its data calls, which were already gated separately.
  if (path === '/admin' && method === 'GET') {
    const basicAuthCheck = requireAdminBasicAuth(request, env);
    if (basicAuthCheck) return basicAuthCheck;
    return serveAdminUI();
  }

  // Admin — protected by X-Admin-Key header
  if (path === '/api/admin/promo-codes' && method === 'POST') return handleCreatePromoCode(request, env);
  if (path === '/api/admin/promo-codes' && method === 'GET')  return handleListPromoCodes(request, env);
  const promoMatch = path.match(/^\/api\/admin\/promo-codes\/([^/]+)$/);
  if (promoMatch && method === 'GET') return handleGetPromoCode(promoMatch[1], request, env);

  // Admin — chore suggestion promotion review queue
  if (path === '/api/admin/promotion-candidates' && method === 'GET') return handleListPromotionCandidates(request, env);
  const promoteMatch = path.match(/^\/api\/admin\/promotion-candidates\/([^/]+)\/promote$/);
  if (promoteMatch && method === 'POST') return handlePromotePromotionCandidate(promoteMatch[1], request, env);
  const dismissMatch = path.match(/^\/api\/admin\/promotion-candidates\/([^/]+)\/dismiss$/);
  if (dismissMatch && method === 'POST') return handleDismissPromotionCandidate(dismissMatch[1], request, env);

  // Admin — exchange rate (locale multiplier) management
  if (path === '/api/admin/exchange-rates' && method === 'GET') return handleGetAdminExchangeRates(request, env);
  const exchangeRateMatch = path.match(/^\/api\/admin\/exchange-rates\/([^/]+)$/);
  if (exchangeRateMatch && method === 'PUT') return handleUpdateExchangeRate(exchangeRateMatch[1], request, env);

  // Admin — agent review queue (list + decline)
  if (path === '/api/admin/agent-review' && method === 'GET')
    return handleListAgentReviewItems(request, env);
  const declineMatch = path.match(/^\/api\/admin\/agent-review\/([^/]+)\/decline$/);
  if (declineMatch && method === 'POST')
    return handleDeclineAgentReviewItem(request, env, declineMatch[1]);
  const adminApproveMatch = path.match(/^\/api\/admin\/agent-review\/([^/]+)\/approve$/);
  if (adminApproveMatch && method === 'POST')
    return handleApproveAgentReviewItem(request, env, adminApproveMatch[1]);
  const sendReplyMatch = path.match(/^\/api\/admin\/agent-review\/([^/]+)\/send-reply$/);
  if (sendReplyMatch && method === 'POST')
    return handleSendReplyAgentReviewItem(request, env, sendReplyMatch[1]);

  // Market rates — CRON health check (no user auth)
  if (path === '/api/market-rates/cron' && method === 'GET') return handleMarketRateCron(request, env);

  // Referral click tracking — public (no auth)
  if (path === '/api/referrals/click' && method === 'POST') return handleReferralClick(request, env);

  // Demo registration — public (professional path, no existing account)
  if (path === '/auth/demo/register' && method === 'POST') return handleDemoRegister(request, env);

  // Pre-launch interest registration — public, no auth
  if (path === '/api/public/interest' && method === 'POST') return handlePublicInterest(request, env);

  // Public ledger chain verification — no auth, no PII returned
  const verifyHashMatch = path.match(/^\/api\/verify\/([a-f0-9]{64})$/);
  if (verifyHashMatch && method === 'GET') return handlePublicLedgerVerify(request, env, verifyHashMatch[1]);

  // One-tap approval link (clicked from an email) — public, the token IS the auth
  const approveMatch = path.match(/^\/api\/support-agent\/review\/([^/]+)\/approve$/);
  if (approveMatch && method === 'GET') return handleApproveReviewItem(request, env, approveMatch[1]);

  // ── All authenticated routes require a valid JWT ─────────────
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;

  // ── CSRF check — only bites cookie-authenticated (web) mutating requests ──
  const csrfCheck = requireCsrfHeader(request, getAuthCookie(request) !== null);
  if (csrfCheck) return csrfCheck;

  // ── Authenticated — any role ──────────────────────────────────
  if (path === '/auth/demo/enter'  && method === 'POST') return withAuth(request, auth, env, ctx, handleDemoEnter);
  if (path === '/auth/demo/notify' && method === 'POST') return withAuth(request, auth, env, ctx, handleDemoNotify);
  if (path === '/auth/demo/active' && method === 'GET')  return withAuth(request, auth, env, ctx, handleDemoActive);

  if (path === '/auth/me'           && method === 'GET')  return withAuth(request, auth, env, ctx, handleMe);
  if (path === '/auth/me'           && method === 'PATCH') return withAuth(request, auth, env, ctx, handleMePatch);
  if (path === '/auth/webauthn/register/options' && method === 'POST') return withAuth(request, auth, env, ctx, handleWebauthnRegisterOptions);
  if (path === '/auth/webauthn/register/verify' && method === 'POST') return withAuth(request, auth, env, ctx, handleWebauthnRegisterVerify);
  if (path === '/auth/verify-email' && method === 'GET')  return handleVerifyEmail(request, env);
  if (path === '/auth/logout'       && method === 'POST') return withAuth(request, auth, env, ctx, handleLogout);

  // Co-parent-aware account deletion — placed before trial check so expired-trial users can still delete
  if (path === '/auth/family/leads'       && method === 'GET')    return withAuth(request, auth, env, ctx, handleFamilyLeads);
  if (path === '/auth/family/co-parents'  && method === 'GET')    return withAuth(request, auth, env, ctx, handleGetCoParents);
  if (path === '/auth/me/leave'           && method === 'DELETE') return withAuth(request, auth, env, ctx, handleLeaveFamily);
  if (path === '/auth/family'             && method === 'DELETE') return withAuth(request, auth, env, ctx, handleDeleteFamily);

  const removeCoParentMatch = path.match(/^\/auth\/family\/co-parent\/([^/]+)$/);
  if (removeCoParentMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleRemoveCoParent(req, e, removeCoParentMatch[1]));

  // In-app support request — placed before trial check so expired-trial users can still get help
  if (path === '/api/support-agent/request' && method === 'POST') return withAuth(request, auth, env, ctx, handleSupportAgentRequest);

  // Settings (any role — children can update their own avatar/theme)
  if (path === '/api/consent/marketing' && method === 'POST') return withAuth(request, auth, env, ctx, handleConsentPost)
  if (path === '/api/consent/marketing' && method === 'GET')  return withAuth(request, auth, env, ctx, handleConsentGet)
  if (path === '/api/consent/analytics' && method === 'POST') return withAuth(request, auth, env, ctx, handleAnalyticsConsentPost)
  if (path === '/api/consent/analytics/effective' && method === 'GET') return withAuth(request, auth, env, ctx, handleAnalyticsEffectiveGet)

  if (path === '/api/settings' && method === 'GET')   return withAuth(request, auth, env, ctx, handleSettingsGet);
  if (path === '/api/settings' && method === 'PATCH')  return withAuth(request, auth, env, ctx, handleSettingsUpdate);

  // Family info (read — any authenticated role)
  if (path === '/api/family'   && method === 'GET')   return withAuth(request, auth, env, ctx, handleFamilyGet);
  if (path === '/api/children' && method === 'GET')   return withAuth(request, auth, env, ctx, handleChildrenList);

  // Child growth path (parent only)
  const childGrowthMatch = path.match(/^\/api\/child-growth\/([^/]+)$/);
  if (childGrowthMatch && method === 'GET')   return withAuth(request, auth, env, ctx, (req, e) => handleChildGrowthGet(req, e, childGrowthMatch[1]));
  if (childGrowthMatch && method === 'PATCH') return withAuth(request, auth, env, ctx, (req, e) => handleChildGrowthUpdate(req, e, childGrowthMatch[1]));

  // Child settings via /api/child/:id/settings — parent only, family-ownership verified
  const childSettingsMatch = path.match(/^\/api\/child\/([^/]+)\/settings$/);
  if (childSettingsMatch) {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    const childId = childSettingsMatch[1];
    const owned = await env.DB.prepare(
      `SELECT user_id FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'child' LIMIT 1`
    ).bind(childId, auth.family_id).first();
    if (!owned) return new Response(JSON.stringify({ error: 'Not found' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    const rewritten = new Request(
      new URL(`/api/settings?user_id=${childId}`, new URL(request.url).origin),
      request,
    );
    if (method === 'GET')   return withAuth(rewritten, auth, env, ctx, handleSettingsGet);
    if (method === 'PATCH') return withAuth(rewritten, auth, env, ctx, handleSettingsUpdate);
  }

  // Child rename + login history (parent only — placed before trial gate intentionally)
  const childIdMatch = path.match(/^\/api\/child\/([^/]+)\/display-name$/);
  if (childIdMatch && method === 'PATCH') return withAuth(request, auth, env, ctx, (req, e) => handleChildRename(req, e, childIdMatch[1]));

  const childHistoryMatch = path.match(/^\/api\/child\/([^/]+)\/login-history$/);
  if (childHistoryMatch && method === 'GET') return withAuth(request, auth, env, ctx, (req, e) => handleChildLoginHistory(req, e, childHistoryMatch[1]));

  const childHandlesMatch = path.match(/^\/api\/child\/([^/]+)\/payment-handles$/);
  if (childHandlesMatch && method === 'PATCH') return withAuth(request, auth, env, ctx, (req, e) => handleSetPaymentHandles(req, e, childHandlesMatch[1]));

  const birthDateMatch = path.match(/^\/api\/children\/([^/]+)\/birth-date$/);
  if (birthDateMatch && method === 'PATCH') return withAuth(request, auth, env, ctx, (req, e) => handleSetChildBirthDate(req, e, birthDateMatch[1]));

  // Teen Mentor Chat — gated by MENTOR_CHAT_ENABLED until the consent UI ships (Track 2 final task)
  if (path === '/api/mentor-chat/messages' && method === 'POST') {
    return withAuth(request, auth, env, ctx, handlePostMentorChatMessage);
  }
  if (path === '/api/mentor-chat/messages' && method === 'GET') {
    return withAuth(request, auth, env, ctx, handleGetMentorChatHistory);
  }

  // Chores — children can list & submit
  if (path === '/api/chores' && method === 'GET')     return withAuth(request, auth, env, ctx, handleChoreList);
  const choreSubmitMatch = path.match(/^\/api\/chores\/([^/]+)\/submit$/);
  if (choreSubmitMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e, c) => handleChoreSubmit(req, e, c, choreSubmitMatch[1]));
  const choreClaimMatch = path.match(/^\/api\/chores\/([^/]+)\/claim$/);
  if (choreClaimMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleChoreClaim(req, e, choreClaimMatch[1]));

  // Completions — children can list their own & rate
  if (path === '/api/completions'         && method === 'GET')  return withAuth(request, auth, env, ctx, handleCompletionList);
  if (path === '/api/completions/count'   && method === 'GET')  return withAuth(request, auth, env, ctx, handleCompletionCount);
  if (path === '/api/completions/history' && method === 'GET')  return withAuth(request, auth, env, ctx, handleCompletionHistory);
  const compRateMatch = path.match(/^\/api\/completions\/([^/]+)\/rate$/);
  if (compRateMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleCompletionRate(req, e, compRateMatch[1]));
  // Proof upload/view — child uploads, both roles view
  const compProofMatch = path.match(/^\/api\/completions\/([^/]+)\/proof$/);
  if (compProofMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleProofUpload(req, e, compProofMatch[1]));
  if (compProofMatch && method === 'GET')  return withAuth(request, auth, env, ctx, (req, e) => handleProofGet(req, e, compProofMatch[1]));

  // Goals — children & parents can read and write their own goals
  if (path === '/api/goals' && method === 'GET')  return withAuth(request, auth, env, ctx, handleGoalList);
  if (path === '/api/goals' && method === 'POST') return withAuth(request, auth, env, ctx, handleGoalCreate);
  const goalIdMatch = path.match(/^\/api\/goals\/([^/]+)$/);
  if (goalIdMatch && method === 'PATCH')  return withAuth(request, auth, env, ctx, (req, e) => handleGoalUpdate(req, e, goalIdMatch[1]));
  if (goalIdMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleGoalDelete(req, e, goalIdMatch[1]));
  const goalReorderMatch = path.match(/^\/api\/goals\/([^/]+)\/reorder$/);
  if (goalReorderMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleGoalReorder(req, e, goalReorderMatch[1]));
  const goalPurchaseMatch = path.match(/^\/api\/goals\/([^/]+)\/purchase$/);
  if (goalPurchaseMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleGoalPurchase(req, e, goalPurchaseMatch[1]));

  // Plans — both roles
  if (path === '/api/plans' && method === 'GET')      return withAuth(request, auth, env, ctx, handlePlanList);
  if (path === '/api/plans' && method === 'POST')     return withAuth(request, auth, env, ctx, handlePlanCreate);
  const planDeleteMatch = path.match(/^\/api\/plans\/([^/]+)$/);
  if (planDeleteMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handlePlanDelete(req, e, planDeleteMatch[1]));

  // Suggestions — children create, both roles can read
  if (path === '/api/suggestions' && method === 'GET')  return withAuth(request, auth, env, ctx, handleSuggestionList);
  if (path === '/api/suggestions' && method === 'POST') return withAuth(request, auth, env, ctx, handleSuggestionCreate);

  // Balance — any role
  if (path === '/api/balance'   && method === 'GET')  return withAuth(request, auth, env, ctx, handleBalance);

  // Jars — child configures own; parent/child can read
  const giveReqMatch = path.match(/^\/api\/give-requests\/(\d+)$/);
  if (path === '/api/jars'            && method === 'GET')   return withAuth(request, auth, env, ctx, handleGetJars);
  if (path === '/api/jars/config'     && method === 'PUT')   return withAuth(request, auth, env, ctx, handlePutJarConfig);
  if (path === '/api/jars/move'       && method === 'POST')  return withAuth(request, auth, env, ctx, handlePostJarMove);
  if (path === '/api/jars/movements'  && method === 'GET')   return withAuth(request, auth, env, ctx, handleGetJarMovements);
  if (path === '/api/give-requests'   && method === 'POST')  return withAuth(request, auth, env, ctx, handlePostGiveRequest);
  if (path === '/api/give-requests'   && method === 'GET')   return withAuth(request, auth, env, ctx, handleGetGiveRequests);
  if (giveReqMatch && method === 'PATCH') return withAuth(request, auth, env, ctx, (req, e) => handlePatchGiveRequest(req, e, giveReqMatch[1]));

  // Insights — parent or child (child sees own data only, enforced in handler)
  if (path === '/api/insights'  && method === 'GET')  return withAuth(request, auth, env, ctx, handleInsights);

  // Family Audit — monthly family-wide rollup for parents (Phase 5)
  if (path === '/api/family-audit' && method === 'GET') return withAuth(request, auth, env, ctx, handleGetFamilyAudit);

  // Child nudges — AI Mentor inline coaching cards
  if (path === '/api/child-nudges'         && method === 'GET')  return withAuth(request, auth, env, ctx, handleGetChildNudges);
  if (path === '/api/child-nudges/dismiss' && method === 'POST') return withAuth(request, auth, env, ctx, handleDismissChildNudge);
  if (path === '/api/child-nudges/impulse-outcome' && method === 'POST') return withAuth(request, auth, env, ctx, handleImpulseOutcome);
  if (path === '/api/push/register'   && method === 'POST') return withAuth(request, auth, env, ctx, handleRegisterDeviceToken);
  if (path === '/api/push/unregister' && method === 'POST') return withAuth(request, auth, env, ctx, handleUnregisterDeviceToken);

  // Streaks — child or parent (child restricted to own data, enforced in handler)
  const streaksMatch = path.match(/^\/api\/streaks\/([^/]+)$/)
  if (streaksMatch && method === 'GET') return withAuth(request, auth, env, ctx, (req, e) => handleGetStreaks(req, e, streaksMatch[1]));

  // Learning Lab
  if (path === '/api/lab/modules' && method === 'GET') return withAuth(request, auth, env, ctx, handleLabModules);
  const labActMatch = path.match(/^\/api\/lab\/modules\/([^/]+)\/acts\/(\d+)\/complete$/)
  if (labActMatch && method === 'POST')
    return withAuth(request, auth, env, ctx, (req, e) =>
      handleLabActComplete(req, e, labActMatch[1], parseInt(labActMatch[2], 10))
    )

  // Market rates — any authenticated role
  if (path === '/api/market-rates' && method === 'GET')        return withAuth(request, auth, env, ctx, handleMarketRateList);
  if (path === '/api/market-rates/suggest' && method === 'POST') return withAuth(request, auth, env, ctx, handleMarketRateSuggest);

  // Referrals — parent only (me + stats)
  if (path === '/api/referrals/me'    && method === 'GET')  return withAuth(request, auth, env, ctx, handleReferralMe);
  if (path === '/api/referrals/stats' && method === 'GET')  return withAuth(request, auth, env, ctx, handleReferralStats);

  // Spending — child logs, both read
  if (path === '/api/spending' && method === 'GET')   return withAuth(request, auth, env, ctx, handleSpendingList);
  if (path === '/api/spending' && method === 'POST')  return withAuth(request, auth, env, ctx, handleSpendingCreate);

  // Payouts — both read
  if (path === '/api/payouts'  && method === 'GET')   return withAuth(request, auth, env, ctx, handlePayoutList);

  // Subscriptions — both read
  if (path === '/api/subscriptions' && method === 'GET') return withAuth(request, auth, env, ctx, handleSubscriptionList);

  // Parent message — child reads
  if (path === '/api/parent-message' && method === 'GET') return withAuth(request, auth, env, ctx, handleParentMessageGet);

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

  // Shared expenses (parent only)
  if (path === '/api/shared-expenses'           && method === 'GET')    return withAuth(request, auth, env, ctx, handleListSharedExpenses);
  if (path === '/api/shared-expenses'           && method === 'POST')   return withAuth(request, auth, env, ctx, handleCreateSharedExpense);
  if (path === '/api/shared-expenses/reconcile' && method === 'POST')   return withAuth(request, auth, env, ctx, handleReconcileSharedExpenses);
  const sharedExpenseIdMatch = path.match(/^\/api\/shared-expenses\/(\d+)$/);
  if (sharedExpenseIdMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleDeleteSharedExpense(req, e, sharedExpenseIdMatch[1]));
  const sharedExpApproveMatch = path.match(/^\/api\/shared-expenses\/(\d+)\/approve$/);
  if (sharedExpApproveMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleApproveSharedExpense(req, e, sharedExpApproveMatch[1]));
  const sharedExpRejectMatch = path.match(/^\/api\/shared-expenses\/(\d+)\/reject$/);
  if (sharedExpRejectMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleRejectSharedExpense(req, e, sharedExpRejectMatch[1]));
  const sharedExpReceiptMatch = path.match(/^\/api\/shared-expenses\/(\d+)\/receipt$/);
  if (sharedExpReceiptMatch && method === 'POST')   return withAuth(request, auth, env, ctx, (req, e) => handleUploadReceipt(req, e, sharedExpReceiptMatch[1]));
  if (sharedExpReceiptMatch && method === 'GET')    return withAuth(request, auth, env, ctx, (req, e) => handleGetReceiptUrl(req, e, sharedExpReceiptMatch[1]));
  if (sharedExpReceiptMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleDeleteReceipt(req, e, sharedExpReceiptMatch[1]));
  const sharedExpVoidMatch = path.match(/^\/api\/shared-expenses\/(\d+)\/void$/);
  if (sharedExpVoidMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleVoidSharedExpense(req, e, sharedExpVoidMatch[1]));
  if (path === '/api/family/settings'           && method === 'PATCH')  return withAuth(request, auth, env, ctx, handleUpdateFamilySettings);

  // Child PIN management
  if (path === '/auth/child/set-pin' && method === 'POST') {
    return withAuth(request, auth, env, ctx, handleSetChildPin);
  }

  // Family write (parent only)
  if (path === '/api/family' && method === 'PATCH') return withAuth(request, auth, env, ctx, handleFamilyUpdate);

  // Chores write (parent only)
  if (path === '/api/chores' && method === 'POST')  return withAuth(request, auth, env, ctx, handleChoreCreate);
  const choreIdMatch = path.match(/^\/api\/chores\/([^/]+)$/);
  if (choreIdMatch && method === 'PATCH')  return withAuth(request, auth, env, ctx, (req, e) => handleChoreUpdate(req, e, choreIdMatch[1]));
  if (choreIdMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleChoreArchive(req, e, choreIdMatch[1]));
  const choreRestoreMatch = path.match(/^\/api\/chores\/([^/]+)\/restore$/);
  if (choreRestoreMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleChoreRestore(req, e, choreRestoreMatch[1]));

  // Completions — payment bridge (static paths before :id regex)
  if (path === '/api/completions/mark-paid-batch'  && method === 'POST') return withAuth(request, auth, env, ctx, handleMarkPaidBatch);
  if (path === '/api/completions/unpaid-summary'   && method === 'GET')  return withAuth(request, auth, env, ctx, handleUnpaidSummary);
  const compMarkPaidMatch = path.match(/^\/api\/completions\/([^/]+)\/mark-paid$/);
  if (compMarkPaidMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleMarkPaid(req, e, compMarkPaidMatch[1]));

  // Completions — parent approval
  const compApproveMatch = path.match(/^\/api\/completions\/([^/]+)\/approve$/);
  if (compApproveMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleCompletionApprove(req, e, compApproveMatch[1]));
  const compReviseMatch = path.match(/^\/api\/completions\/([^/]+)\/revise$/);
  if (compReviseMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleCompletionRevise(req, e, compReviseMatch[1]));
  const compRejectMatch = path.match(/^\/api\/completions\/([^/]+)\/reject$/);
  if (compRejectMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e, c) => handleCompletionReject(req, e, c, compRejectMatch[1]));
  if (path === '/api/completions/approve-all' && method === 'POST') return withAuth(request, auth, env, ctx, handleApproveAll);

  if (path === '/api/review-prompt/outcome'  && method === 'POST') return withAuth(request, auth, env, ctx, handleReviewOutcome);
  if (path === '/api/review-prompt/feedback' && method === 'POST') return withAuth(request, auth, env, ctx, handleReviewFeedback);

  // Goals — contribute is parent-only (parent tops up child's goal)
  const goalContributeMatch = path.match(/^\/api\/goals\/([^/]+)\/contribute$/);
  if (goalContributeMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleGoalContribute(req, e, goalContributeMatch[1]));

  // Finance write — parent only
  if (path === '/api/payouts' && method === 'POST')        return withAuth(request, auth, env, ctx, handlePayoutCreate);
  if (path === '/api/bonus'   && method === 'POST')        return withAuth(request, auth, env, ctx, handleBonusCreate);
  if (path === '/api/bonus'   && method === 'GET')         return withAuth(request, auth, env, ctx, handleBonusList);
  if (path === '/api/subscriptions' && method === 'POST')  return withAuth(request, auth, env, ctx, handleSubscriptionCreate);
  const subIdMatch = path.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (subIdMatch && method === 'PATCH')  return withAuth(request, auth, env, ctx, (req, e) => handleSubscriptionUpdate(req, e, subIdMatch[1]));
  if (subIdMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleSubscriptionCancel(req, e, subIdMatch[1]));

  // Suggestions — parent approves/rejects
  const sugApproveMatch = path.match(/^\/api\/suggestions\/([^/]+)\/approve$/);
  if (sugApproveMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleSuggestionApprove(req, e, sugApproveMatch[1]));
  const sugRejectMatch = path.match(/^\/api\/suggestions\/([^/]+)\/reject$/);
  if (sugRejectMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleSuggestionReject(req, e, sugRejectMatch[1]));

  // Account lock/unlock
  if (path === '/api/account-lock' && method === 'POST') return withAuth(request, auth, env, ctx, handleAccountLock);
  if (path === '/api/account-lock/me' && method === 'GET') return withAuth(request, auth, env, ctx, handleAccountLockStatusMe);
  const unlockMatch = path.match(/^\/api\/account-lock\/([^/]+)$/);
  if (unlockMatch && method === 'DELETE') return withAuth(request, auth, env, ctx, (req, e) => handleAccountUnlock(req, e, unlockMatch[1]));

  // Parent message
  if (path === '/api/parent-message' && method === 'POST') return withAuth(request, auth, env, ctx, handleParentMessageSet);

  // Invite code generation + child onboarding + registration persistence
  if (path === '/auth/invite/generate'        && method === 'POST') return withAuth(request, auth, env, ctx, handleGenerateInvite);
  if (path === '/auth/child/add'               && method === 'POST') return withAuth(request, auth, env, ctx, handleAddChild);
  const regenChildInviteMatch = path.match(/^\/auth\/child\/([^/]+)\/invite$/);
  if (regenChildInviteMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleRegenerateChildInvite(req, e, regenChildInviteMatch[1]));
  if (path === '/auth/registration/save-step'  && method === 'POST') return withAuth(request, auth, env, ctx, handleSaveRegistrationStep);

  // Ledger
  if (path === '/api/ledger') {
    if (method === 'POST') {
      const parentCheck = requireRole(auth, 'parent');
      if (parentCheck) return parentCheck;
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
  if (verifyMatch && method === 'POST') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    return withAuth(request, auth, env, ctx, (req, e) => handleLedgerVerify(req, e, verifyMatch[1]));
  }

  const raiseDisputeMatch = path.match(/^\/api\/ledger\/(\d+)\/raise-dispute$/);
  if (raiseDisputeMatch && method === 'POST') return withAuth(request, auth, env, ctx, (req, e) => handleRaiseDispute(req, e, raiseDisputeMatch[1]));

  const disputeMatch = path.match(/^\/api\/ledger\/(\d+)\/dispute$/);
  if (disputeMatch && method === 'POST') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    return withAuth(request, auth, env, ctx, (req, e) => handleLedgerDispute(req, e, disputeMatch[1]));
  }

  // Export
  if (path === '/api/export/json' && method === 'GET') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    const famCheck = requireFamilyMatch(auth, new URL(request.url).searchParams.get('family_id') ?? '');
    if (famCheck) return famCheck;
    return handleExportJson(request, env);
  }
  if (path === '/api/export/pdf' && method === 'GET') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    const famCheck = requireFamilyMatch(auth, new URL(request.url).searchParams.get('family_id') ?? '');
    if (famCheck) return famCheck;
    return handleExportPdf(request, env);
  }
  if (path === '/api/export/prune-check' && method === 'GET') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    return handleExportPruneCheck(request, env, auth);
  }
  if (path === '/api/export/prune' && method === 'POST') {
    const parentCheck = requireRole(auth, 'parent');
    if (parentCheck) return parentCheck;
    return handleExportPrune(request, env, auth);
  }

  // Shield upgrade price preview (parent only, post-auth)
  if (path === '/api/stripe/shield-upgrade-price' && method === 'GET') {
    return handleShieldUpgradePrice(request, env, auth);
  }

  // Stripe checkout (parent only, post-auth)
  if (path === '/api/stripe/create-checkout' && method === 'POST') {
    return handleCreateCheckout(request, env, auth);
  }

  if (path === '/api/billing/cancel' && method === 'DELETE') {
    return handleCancelPlan(request, env, auth);
  }

  // Payment history (parent only)
  if (path === '/api/billing/history' && method === 'GET') {
    const leadCheck = requireRole(auth, 'parent');
    if (leadCheck) return leadCheck;
    const rows = await env.DB
      .prepare(`
        SELECT payment_type, amount_paid_int, currency, created_at
        FROM payment_audit_log
        WHERE family_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `)
      .bind(auth.family_id)
      .all<{ payment_type: string; amount_paid_int: number; currency: string; created_at: string }>();
    return json({ payments: rows.results });
  }

  // Governance — mutual consent handshake for verify_mode changes
  if (path === '/api/governance/request' && method === 'POST') return withAuth(request, auth, env, ctx, handleGovernanceRequest);
  if (path === '/api/governance/expire'  && method === 'POST') {
    const adminCheck = requireAdmin(request, env);
    if (adminCheck) return adminCheck;
    return handleGovernanceExpire(request, env);
  }
  if (path === '/api/governance'         && method === 'GET')  return withAuth(request, auth, env, ctx, handleGovernanceGet);

  const govActionMatch = path.match(/^\/api\/governance\/(\d+)\/(confirm|reject)$/);
  if (govActionMatch && method === 'POST') {
    const [, id, action] = govActionMatch;
    if (action === 'confirm') return withAuth(request, auth, env, ctx, (req, e) => handleGovernanceConfirm(req, e, id));
    if (action === 'reject')  return withAuth(request, auth, env, ctx, (req, e) => handleGovernanceReject(req, e, id));
  }

  // ── Security / PIN ────────────────────────────────────────────────
  if (method === 'POST' && path === '/auth/pin/set')
    return withAuth(request, auth, env, ctx, handlePinSet);
  // Same handler — distinct route name lets the frontend show different copy ("Forgot PIN?")
  if (method === 'POST' && path === '/auth/pin/reset-with-password')
    return withAuth(request, auth, env, ctx, handlePinSet);
  if (method === 'POST' && path === '/auth/verify-pin')
    return withAuth(request, auth, env, ctx, handleVerifyPin);

  // ── Sessions ──────────────────────────────────────────────────────
  if (method === 'GET' && path === '/auth/sessions')
    return withAuth(request, auth, env, ctx, handleGetSessions);
  if (method === 'DELETE' && path === '/auth/sessions' && new URL(request.url).searchParams.get('others') === 'true')
    return withAuth(request, auth, env, ctx, handleRevokeOtherSessions);
  if (method === 'DELETE' && path.startsWith('/auth/sessions/'))
    return withAuth(request, auth, env, ctx, handleRevokeSession);

  // Dev endpoints — only active when ENVIRONMENT === 'development'
  if (path.startsWith('/dev/')) {
    return handleDevRequest(request, env);
  }

  return error('Not found', 404);
}

// ----------------------------------------------------------------
// Inject auth payload into request for use by handlers
// ----------------------------------------------------------------
function withAuth(
  request: Request,
  auth: JwtPayload,
  env: Env,
  ctx: ExecutionContext,
  handler: (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>,
): Promise<Response> {
  const augmented = Object.assign(request, { auth });
  return handler(augmented, env, ctx);
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
    // Must stay an exact match — never a wildcard — now that credentialed
    // (cookie-carrying) requests are allowed. Browsers reject wildcard +
    // credentials combinations, but keep this explicit as a guard against
    // a future accidental regression.
    'Access-Control-Allow-Origin':      'https://app.morechard.com',
    'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization, X-Morechard-Client',
    'Access-Control-Allow-Credentials': 'true',
  };
}

// Baseline hardening headers for every API response. The API only ever
// returns JSON (never renders untrusted HTML), so CSP here just needs to
// forbid the response being treated as a document/frame — the app's own
// _headers file carries the real content CSP.
function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options':   'nosniff',
    'X-Frame-Options':          'DENY',
    'Referrer-Policy':          'strict-origin-when-cross-origin',
    'Content-Security-Policy':  "default-src 'none'; frame-ancestors 'none'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy':       'camera=(), microphone=(), geolocation=()',
  };
}
