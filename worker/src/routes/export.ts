/**
 * Export routes — GDPR/RODO Right to Portability + Tiered PDF Reports
 *
 * GET /api/export/json?family_id=&lang=en|pl
 *   Full structured data export. Satisfies GDPR Article 20 (data portability).
 *
 * GET /api/export/pdf?family_id=&lang=en|pl&tier=basic|behavioral|forensic
 *   Returns a print-ready HTML document. Three tiers:
 *
 *   basic       — Family Orchard Summary (Standard £34.99 licence)
 *                 Summary cards, ledger table, status log.
 *
 *   behavioral  — Growth & Learning Curriculum (Basic + £19.99 AI Mentor)
 *                 All basic content plus Learning Lab modules and Behavioural Pulse.
 *
 *   forensic    — Immutable Chain of Custody (Legal version)
 *                 Full SHA-256 proof hashes, verification confidence, Haversine
 *                 variance, device fingerprint, governance audit. No Orchard metaphors.
 *
 * Privacy constraint: GPS coordinates and IP addresses are read from D1 and
 * rendered directly into the PDF response. They are never returned to or stored
 * in client-side state.
 */

import { Env } from '../types.js';
import { error } from '../lib/response.js';
import { sha256 } from '../lib/hash.js';

// ----------------------------------------------------------------
// GET /api/export/json
// ----------------------------------------------------------------
export async function handleExportJson(request: Request, env: Env): Promise<Response> {
  const url       = new URL(request.url);
  const family_id = url.searchParams.get('family_id');
  const lang      = url.searchParams.get('lang') === 'pl' ? 'pl' : 'en';

  if (!family_id) return error('family_id required');

  const [family, users, ledger, governance, statusLog, snapshots, labels] = await Promise.all([
    env.DB.prepare('SELECT * FROM families WHERE id = ?').bind(family_id).first(),
    env.DB.prepare('SELECT id, display_name, locale FROM users WHERE family_id = ?').bind(family_id).all(),
    env.DB.prepare('SELECT * FROM ledger WHERE family_id = ? ORDER BY id ASC').bind(family_id).all(),
    env.DB.prepare('SELECT * FROM family_governance_log WHERE family_id = ? ORDER BY id ASC').bind(family_id).all(),
    env.DB.prepare(`SELECT lsl.* FROM ledger_status_log lsl
                    JOIN ledger l ON l.id = lsl.ledger_id
                    WHERE l.family_id = ? ORDER BY lsl.id ASC`).bind(family_id).all(),
    env.DB.prepare(`SELECT cs.* FROM currency_snapshots cs
                    JOIN ledger l ON l.id = cs.ledger_id
                    WHERE l.family_id = ? ORDER BY cs.id ASC`).bind(family_id).all(),
    env.DB.prepare('SELECT * FROM bilingual_labels').all(),
  ]);

  if (!family) return error('Family not found', 404);

  const labelMap = buildLabelMap(labels.results as unknown as LabelRow[], lang);

  const enrichedLedger = (ledger.results as Record<string, unknown>[]).map(row => ({
    ...row,
    category_label:      row['category']     ? labelMap[row['category'] as string]     ?? row['category']     : null,
    dispute_code_label:  row['dispute_code'] ? labelMap[row['dispute_code'] as string] ?? row['dispute_code'] : null,
  }));

  const enrichedGovernance = (governance.results as Record<string, unknown>[]).map(row => ({
    ...row,
    action_taken: row['new_mode'] === 'amicable'
      ? (lang === 'pl' ? 'Włączono automatyczną weryfikację (tryb zgodny)' : 'Enabled Auto-Verify (Amicable Mode)')
      : (lang === 'pl' ? 'Włączono ręczną weryfikację (tryb standardowy)' : 'Enabled Manual Approval (Standard Mode)'),
  }));

  const exportPayload = {
    export_meta: {
      family_id,
      exported_at: new Date().toISOString(),
      lang,
      gdpr_basis: 'Article 20 — Right to Data Portability',
    },
    family,
    users: users.results,
    ledger: enrichedLedger,
    governance_log: enrichedGovernance,
    status_log: statusLog.results,
    currency_snapshots: snapshots.results,
    bilingual_labels: labelMap,
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="morechard-export-${family_id}-${Date.now()}.json"`,
    },
  });
}

// ----------------------------------------------------------------
// GET /api/export/pdf  (returns print-ready HTML)
// ----------------------------------------------------------------
export async function handleExportPdf(request: Request, env: Env): Promise<Response> {
  const url       = new URL(request.url);
  const family_id = url.searchParams.get('family_id');
  const lang      = url.searchParams.get('lang') === 'pl' ? 'pl' : 'en';
  const rawTier   = url.searchParams.get('tier') ?? 'basic';
  const tier: ReportTier = rawTier === 'forensic' ? 'forensic'
                         : rawTier === 'behavioral' ? 'behavioral'
                         : 'basic';

  if (!family_id) return error('family_id required');

  // Base queries — always needed
  const [family, ledgerRes, govRes, labelsRes] = await Promise.all([
    env.DB.prepare(
      'SELECT id, name, currency, verify_mode, home_lat, home_lng FROM families WHERE id = ?'
    ).bind(family_id).first<FamilyRow>(),
    env.DB.prepare(
      `SELECT l.*, u.display_name AS child_name
       FROM ledger l
       LEFT JOIN users u ON u.id = l.child_id
       WHERE l.family_id = ? ORDER BY l.id ASC`
    ).bind(family_id).all(),
    env.DB.prepare('SELECT * FROM family_governance_log WHERE family_id = ? ORDER BY id ASC').bind(family_id).all(),
    env.DB.prepare('SELECT * FROM bilingual_labels').all(),
  ]);

  if (!family) return error('Family not found', 404);

  // Server-side tier enforcement — prevents crafted requests bypassing frontend gates
  if (tier === 'behavioral') {
    const tierRow = await env.DB
      .prepare('SELECT ai_subscription_expiry FROM families WHERE id = ?')
      .bind(family_id)
      .first<{ ai_subscription_expiry: string | null }>();
    const active = tierRow?.ai_subscription_expiry
      && new Date(tierRow.ai_subscription_expiry).getTime() > Date.now();
    if (!active) return error('AI Mentor subscription required', 403);
  }

  if (tier === 'forensic') {
    const tierRow = await env.DB
      .prepare('SELECT has_shield FROM families WHERE id = ?')
      .bind(family_id)
      .first<{ has_shield: number }>();
    if (!tierRow?.has_shield) return error('Shield plan required', 403);
  }

  const labelMap   = buildLabelMap(labelsRes.results as unknown as LabelRow[], lang);
  const ledgerRows = ledgerRes.results as unknown as LedgerRow[];
  const govRows    = govRes.results as unknown as GovRow[];

  // Tier-specific supplementary data
  let statusRows:   StatusLogRow[]    = [];
  let completions:  CompletionRow[]   = [];
  let moduleRows:   LearningModuleRow[] = [];
  let rewardEdits:  RewardEditRow[]   = [];
  let loginRows:    LoginHistoryRow[] = [];

  if (tier !== 'basic') {
    // Status log for behavioral pulse
    const slRes = await env.DB.prepare(
      `SELECT lsl.* FROM ledger_status_log lsl
       JOIN ledger l ON l.id = lsl.ledger_id
       WHERE l.family_id = ? ORDER BY lsl.id ASC`
    ).bind(family_id).all();
    statusRows = slRes.results as unknown as StatusLogRow[];

    // Learning module unlocks (if table exists — graceful fallback)
    try {
      const modRes = await env.DB.prepare(
        `SELECT m.slug, m.unlocked_at, m.child_id, u.display_name AS child_name
         FROM learning_module_unlocks m
         LEFT JOIN users u ON u.id = m.child_id
         WHERE m.family_id = ? ORDER BY m.unlocked_at ASC`
      ).bind(family_id).all();
      moduleRows = modRes.results as unknown as LearningModuleRow[];
    } catch { /* table not yet migrated */ }
  }

  if (tier === 'forensic') {
    // Full completion rows with device/location data — privacy-safe: only in PDF
    const compRes = await env.DB.prepare(
      `SELECT c.id, c.chore_id, c.child_id, c.submitted_at,
              c.verified_at, c.proof_hash, c.verification_confidence,
              c.haversine_km, c.network_city, c.network_ip,
              c.device_model, c.user_agent, c.device_fingerprint,
              u.display_name AS child_name
       FROM completions c
       JOIN chores ch ON ch.id = c.chore_id
       LEFT JOIN users u ON u.id = c.child_id
       WHERE ch.family_id = ? ORDER BY c.submitted_at ASC`
    ).bind(family_id).all();
    completions = compRes.results as unknown as CompletionRow[];

    // Reward override / edit audit
    try {
      const editRes = await env.DB.prepare(
        `SELECT actor_id, chore_id, old_amount, new_amount, changed_at, reason
         FROM chore_reward_edits WHERE family_id = ? ORDER BY changed_at ASC`
      ).bind(family_id).all();
      rewardEdits = editRes.results as unknown as RewardEditRow[];
    } catch { /* table not yet migrated */ }

    // Login history — parent sessions + child logins, merged and sorted by time.
    // user_agent column added in migration 0011; graceful fallback if absent.
    const [parentSessions, childLogins] = await Promise.all([
      env.DB.prepare(
        `SELECT u.display_name, s.issued_at AS event_at, s.ip_address,
                s.user_agent, s.role, 'Login' AS action
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.family_id = ?
         ORDER BY s.issued_at ASC`
      ).bind(family_id).all().catch(() => ({ results: [] })),
      env.DB.prepare(
        `SELECT u.display_name, cl.logged_at AS event_at, cl.ip_address,
                NULL AS user_agent, 'child' AS role, 'Upload' AS action
         FROM child_logins cl
         JOIN users u ON u.id = cl.child_id
         WHERE cl.family_id = ?
         ORDER BY cl.logged_at ASC`
      ).bind(family_id).all().catch(() => ({ results: [] })),
    ]);

    loginRows = [
      ...(parentSessions.results as unknown as LoginHistoryRow[]),
      ...(childLogins.results as unknown as LoginHistoryRow[]),
    ].sort((a, b) => a.event_at - b.event_at);
  }

  // Document fingerprint — SHA-256 of (family_id + row count + export timestamp)
  const exportTs          = Math.floor(Date.now() / 1000);
  const fingerprintInput  = `${family_id}|${ledgerRows.length}|${exportTs}|${tier}`;
  const fingerprint       = await sha256(fingerprintInput);
  const shortFp           = fingerprint.slice(0, 16).toUpperCase();
  const docUuid           = `MCH-${shortFp.slice(0, 4)}-${shortFp.slice(4, 8)}-${shortFp.slice(8, 12)}-${shortFp.slice(12)}`;

  const pending  = ledgerRows.filter(r => r.verification_status === 'pending').length;
  const verified = ledgerRows.filter(r => r.verification_status.startsWith('verified')).length;
  const disputed = ledgerRows.filter(r => r.verification_status === 'disputed').length;
  const totalEarned = ledgerRows
    .filter(r => r.entry_type === 'credit')
    .reduce((s, r) => s + r.amount, 0);
  const totalTasks = ledgerRows.filter(r => r.entry_type === 'credit').length;

  let html: string;

  if (tier === 'forensic') {
    html = buildForensicReport({
      family, lang, ledgerRows, govRows, completions, rewardEdits, loginRows,
      statusRows, labelMap, fingerprint, shortFp, docUuid,
      exportTs, pending, verified, disputed, totalEarned, totalTasks,
    });
  } else if (tier === 'behavioral') {
    html = buildBehavioralReport({
      family, lang, ledgerRows, govRows, statusRows, moduleRows, labelMap,
      fingerprint, shortFp, docUuid, exportTs,
      pending, verified, disputed, totalEarned, totalTasks,
    });
  } else {
    html = buildBasicReport({
      family, lang, ledgerRows, govRows, statusRows, labelMap,
      fingerprint, shortFp, docUuid, exportTs,
      pending, verified, disputed, totalEarned, totalTasks,
    });
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="morechard-${tier}-report-${family_id}-${Date.now()}.html"`,
    },
  });
}

// ----------------------------------------------------------------
// POST /api/export/prune
// Lead-parent only. Identifies ledger rows older than 2 years,
// archives their hashes, then zeroes PII columns (description,
// ip_address, receipt_id). Also nulls proof_exif and system_verify
// on linked completions. Hash-chain columns are untouched.
// ----------------------------------------------------------------
export async function handleExportPrune(
  request: Request,
  env: Env,
  auth: { sub: string; family_id: string; role: string },
): Promise<Response> {
  const family_id = auth.family_id;

  // Lead-only gate
  const caller = await env.DB
    .prepare(`SELECT parent_role FROM family_roles WHERE user_id = ? AND family_id = ? AND role = 'parent'`)
    .bind(auth.sub, family_id)
    .first<{ parent_role: string }>();
  if (!caller || caller.parent_role !== 'lead') {
    return error('Only the lead parent can prune data', 403);
  }

  const cutoff = Math.floor(Date.now() / 1000) - 2 * 365 * 86400;

  const { results: candidates } = await env.DB
    .prepare(`
      SELECT id, record_hash, previous_hash
      FROM ledger
      WHERE family_id = ? AND created_at < ? AND pruned_at IS NULL
    `)
    .bind(family_id, cutoff)
    .all<{ id: number; record_hash: string; previous_hash: string }>();

  if (candidates.length === 0) {
    return new Response(JSON.stringify({ pruned: 0, archived: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let archived = 0;

  for (const row of candidates) {
    // Archive hash proof before scrubbing
    await env.DB
      .prepare(`INSERT INTO ledger_prune_archive (ledger_id, record_hash, previous_hash, archived_at) VALUES (?, ?, ?, unixepoch())`)
      .bind(row.id, row.record_hash, row.previous_hash)
      .run();

    // Zero PII on ledger row (hash-chain columns untouched)
    await env.DB
      .prepare(`UPDATE ledger SET description = '[archived]', ip_address = NULL, receipt_id = NULL, pruned_at = unixepoch() WHERE id = ? AND family_id = ?`)
      .bind(row.id, family_id)
      .run();

    // Zero PII on linked completions (EXIF + system verify contain GPS/IP)
    await env.DB
      .prepare(`
        UPDATE completions
        SET proof_exif = NULL, system_verify = NULL
        WHERE chore_id IN (
          SELECT chore_id FROM ledger WHERE id = ? AND family_id = ? AND chore_id IS NOT NULL
        )
      `)
      .bind(row.id, family_id)
      .run();

    archived++;
  }

  return new Response(JSON.stringify({ pruned: candidates.length, archived }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ================================================================
// Report builders
// ================================================================

interface ReportContext {
  family:       FamilyRow;
  lang:         string;
  ledgerRows:   LedgerRow[];
  govRows:      GovRow[];
  statusRows:   StatusLogRow[];
  labelMap:     Record<string, string>;
  fingerprint:  string;
  shortFp:      string;
  docUuid:      string;
  exportTs:     number;
  pending:      number;
  verified:     number;
  disputed:     number;
  totalEarned:  number;
  totalTasks:   number;
}

// ----------------------------------------------------------------
// Version A — Basic Report (Standard licence)
// ----------------------------------------------------------------
function buildBasicReport(ctx: ReportContext): string {
  const { family, lang, ledgerRows, statusRows, labelMap,
          fingerprint, shortFp, docUuid, exportTs,
          pending, verified, disputed, totalEarned, totalTasks } = ctx;
  const pl = lang === 'pl';

  const title   = pl ? 'Podsumowanie Rodzinnego Sadu' : 'Family Orchard Summary';
  const heading = pl ? 'Raport Rodziny' : 'Family Report';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>Morechard — ${escHtml(title)} — ${escHtml(family.name)}</title>
${baseStyles()}
<style>
  .summary-card { border-left: 4px solid #5b8c3e; }
  h1 span.tier-badge { background:#e8f5e9; color:#2e7d32; font-size:12px; padding:2px 10px; border-radius:12px; font-weight:600; vertical-align:middle; margin-left:8px; }
</style>
</head>
<body>

<h1>Morechard — ${escHtml(heading)} <span class="tier-badge">${pl ? 'Wersja Podstawowa' : 'Basic Edition'}</span></h1>
<div class="meta">
  ${pl ? 'Rodzina' : 'Family'}: <strong>${escHtml(family.name)}</strong> &nbsp;|&nbsp;
  ${pl ? 'Wygenerowano' : 'Exported at'}: <strong>${new Date(exportTs * 1000).toISOString()}</strong> &nbsp;|&nbsp;
  ${pl ? 'Waluta' : 'Currency'}: <strong>${family.currency}</strong>
</div>
<p class="report-description">${pl
  ? 'Ten raport zawiera pełne podsumowanie aktywności Twojej rodziny, w tym zarobki i wykonane zadania.'
  : 'This report contains a complete summary of your family\'s activity, including earnings and completed tasks.'}</p>

<h2>${pl ? 'Podsumowanie' : 'Summary'}</h2>
<div class="summary-grid">
  <div class="summary-card"><div class="num">${fmtAmount(totalEarned, family.currency)}</div><div class="label">${pl ? 'Łącznie zarobiono' : 'Total Earned'}</div></div>
  <div class="summary-card"><div class="num">${totalTasks}</div><div class="label">${pl ? 'Ukończonych zadań' : 'Total Tasks Completed'}</div></div>
  <div class="summary-card"><div class="num">${verified}</div><div class="label">${pl ? 'Zweryfikowanych' : 'Verified'}</div></div>
  <div class="summary-card"><div class="num">${pending}</div><div class="label">${pl ? 'Oczekujących' : 'Pending'}</div></div>
</div>
${disputed > 0 ? `<p class="warn">⚠ ${disputed} ${pl ? 'wpis(-ów) zakwestionowanych' : 'disputed entry/entries'}</p>` : ''}

<h2>${pl ? 'Rejestr transakcji' : 'Transaction Ledger'}</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>${pl ? 'Data' : 'Date'}</th><th>${pl ? 'Opis' : 'Description'}</th>
      <th>${pl ? 'Kategoria' : 'Category'}</th><th>${pl ? 'Kwota' : 'Amount'}</th>
      <th>${pl ? 'Status' : 'Status'}</th>
    </tr>
  </thead>
  <tbody>
    ${ledgerRows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td>${escHtml(r.description)}</td>
      <td>${r.category ? (labelMap[r.category] ?? r.category) : '—'}</td>
      <td class="num-cell">${fmtAmount(r.amount, r.currency)}</td>
      <td><span class="badge-${badgeClass(r.verification_status)}">${statusLabel(r.verification_status, lang)}</span></td>
    </tr>`).join('')}
  </tbody>
</table>

${statusRows.length > 0 ? `
<h2>${pl ? 'Dziennik statusów' : 'Status Log'}</h2>
<table>
  <thead>
    <tr><th>#</th><th>${pl ? 'Data' : 'Date'}</th><th>${pl ? 'Wpis' : 'Entry'}</th><th>${pl ? 'Z' : 'From'}</th><th>${pl ? 'Na' : 'To'}</th><th>${pl ? 'Zatwierdzone przez' : 'Approver'}</th></tr>
  </thead>
  <tbody>
    ${statusRows.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${fmtDate(s.created_at)}</td>
      <td>${s.ledger_id}</td>
      <td><span class="badge-${badgeClass(s.from_status)}">${statusLabel(s.from_status, lang)}</span></td>
      <td><span class="badge-${badgeClass(s.to_status)}">${statusLabel(s.to_status, lang)}</span></td>
      <td>${escHtml(s.actor_id)}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

${fingerprintBlock(fingerprint, shortFp, lang)}
${declarationFooter(family.name, exportTs, lang, docUuid, false)}

</body>
</html>`;
}

// ----------------------------------------------------------------
// Version B — Behavioral Insights Report (Basic + AI Mentor)
// ----------------------------------------------------------------
interface BehavioralContext extends ReportContext {
  moduleRows: LearningModuleRow[];
}

function buildBehavioralReport(ctx: BehavioralContext): string {
  const { family, lang, ledgerRows, statusRows, moduleRows, labelMap,
          fingerprint, shortFp, docUuid, exportTs,
          verified, disputed, totalEarned, totalTasks } = ctx;
  const pl = lang === 'pl';

  const title = pl ? 'Curriculum Wzrostu i Nauki' : 'Growth & Learning Curriculum';

  // Derive behavioural pulse signals from ledger + status data
  const pulse = deriveBehaviouralPulse(ledgerRows, statusRows, lang);

  // Module display names
  const moduleNames: Record<string, string> = {
    'effort-vs-reward':         pl ? 'Wysiłek a nagroda'            : 'Effort vs. Reward',
    'taxes-net-pay':            pl ? 'Podatki i wynagrodzenie netto' : 'Taxes & Net Pay',
    'entrepreneurship':         pl ? 'Przedsiębiorczość'             : 'Entrepreneurship',
    'gig-trap-vs-salary-safety':pl ? 'Pułapka freelance'            : 'Gig Trap vs. Salary Safety',
    'needs-vs-wants':           pl ? 'Potrzeby a zachcianki'         : 'Needs vs. Wants',
    'scams-digital-safety':     pl ? 'Oszustwa i bezpieczeństwo'     : 'Scams & Digital Safety',
    'advertising-influence':    pl ? 'Reklama i wpływ'              : 'Advertising & Influence',
    'the-patience-tree':        pl ? 'Drzewo cierpliwości'           : 'The Patience Tree',
    'banking-101':              pl ? 'Bankowość 101'                 : 'Banking 101',
    'opportunity-cost':         pl ? 'Koszt alternatywny'            : 'Opportunity Cost',
    'the-snowball':             pl ? 'Kula śnieżna'                  : 'The Snowball',
    'the-interest-trap':        pl ? 'Pułapka odsetek'              : 'The Interest Trap',
    'credit-scores-and-trust':  pl ? 'Scoring kredytowy'            : 'Credit Scores & Trust',
    'good-vs-bad-debt':         pl ? 'Dobry i zły dług'             : 'Good vs. Bad Debt',
    'compound-growth':          pl ? 'Wzrost procentu składanego'   : 'Compound Growth',
    'inflation':                pl ? 'Inflacja'                      : 'Inflation',
    'risk-and-diversification': pl ? 'Ryzyko i dywersyfikacja'       : 'Risk & Diversification',
    'giving-and-charity':       pl ? 'Dawanie i charytatywność'      : 'Giving & Charity',
    'digital-vs-physical-currency': pl ? 'Waluta cyfrowa a fizyczna' : 'Digital vs. Physical Currency',
    'money-and-mental-health':  pl ? 'Pieniądze i zdrowie psychiczne': 'Money & Mental Health',
    'social-comparison':        pl ? 'Porównywanie społeczne'        : 'Social Comparison',
    'cryptocurrency':           pl ? 'Kryptowaluty'                  : 'Cryptocurrency',
  };

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>Morechard — ${escHtml(title)} — ${escHtml(family.name)}</title>
${baseStyles()}
<style>
  .summary-card { border-left: 4px solid #7b5ea7; }
  h1 span.tier-badge { background:#f3e5f5; color:#6a1b9a; font-size:12px; padding:2px 10px; border-radius:12px; font-weight:600; vertical-align:middle; margin-left:8px; }
  .pulse-box { padding:14px 16px; border:1px solid #ce93d8; border-radius:6px; background:#fce4ec10; margin-bottom:16px; }
  .pulse-signal { display:inline-block; margin:3px 4px; padding:3px 10px; border-radius:12px; font-size:10px; font-weight:600; }
  .pulse-signal.positive { background:#e8f5e9; color:#2e7d32; }
  .pulse-signal.caution  { background:#fff8e1; color:#f57f17; }
  .pulse-signal.concern  { background:#fce4ec; color:#b71c1c; }
  .pulse-child { font-size:9px; font-weight:400; opacity:0.8; margin-left:4px; }
  .module-grid { display:grid; grid-template-columns: repeat(2,1fr); gap:8px; margin-bottom:16px; }
  .module-card { border:1px solid #e1bee7; border-radius:6px; padding:8px 12px; background:#fdf6ff; }
  .module-card .mod-name { font-weight:600; font-size:11px; }
  .module-card .mod-meta { font-size:9px; color:#888; }
</style>
</head>
<body>

<h1>Morechard — ${escHtml(pl ? 'Raport Edukacyjny' : 'Educational Report')} <span class="tier-badge">${pl ? 'Wersja z Mentorem AI' : 'AI Mentor Edition'}</span></h1>
<div class="meta">
  ${pl ? 'Rodzina' : 'Family'}: <strong>${escHtml(family.name)}</strong> &nbsp;|&nbsp;
  ${pl ? 'Wygenerowano' : 'Exported at'}: <strong>${new Date(exportTs * 1000).toISOString()}</strong> &nbsp;|&nbsp;
  ${pl ? 'Waluta' : 'Currency'}: <strong>${family.currency}</strong>
</div>
<p class="report-description">${pl
  ? 'Ten raport łączy podsumowanie finansowe z analizą edukacyjną, ukazując postępy w nauce finansowej.'
  : 'This report combines the financial summary with educational analysis, showing progress in financial literacy.'}</p>

<h2>${pl ? 'Podsumowanie' : 'Summary'}</h2>
<div class="summary-grid">
  <div class="summary-card"><div class="num">${fmtAmount(totalEarned, family.currency)}</div><div class="label">${pl ? 'Łącznie zarobiono' : 'Total Earned'}</div></div>
  <div class="summary-card"><div class="num">${totalTasks}</div><div class="label">${pl ? 'Ukończonych zadań' : 'Total Tasks'}</div></div>
  <div class="summary-card"><div class="num">${moduleRows.length}</div><div class="label">${pl ? 'Odblokowanych modułów' : 'Modules Unlocked'}</div></div>
  <div class="summary-card"><div class="num">${verified}</div><div class="label">${pl ? 'Zweryfikowanych' : 'Verified'}</div></div>
</div>
${disputed > 0 ? `<p class="warn">⚠ ${disputed} ${pl ? 'wpis(-ów) zakwestionowanych' : 'disputed entry/entries'}</p>` : ''}

<h2>${pl ? 'Puls Zachowań' : 'Behavioural Pulse'}</h2>
<div class="pulse-box">
  <p style="font-size:10px;margin-bottom:8px;color:#555">${pl
    ? 'Sygnały wyprowadzone z wzorców aktywności. Nie stanowią oceny — to wskazówki edukacyjne.'
    : 'Signals derived from activity patterns. These are coaching guides, not judgements.'}</p>
  ${pulse.map(p => `<span class="pulse-signal ${p.type}">${escHtml(p.label)}${p.child_name ? `<span class="pulse-child">— ${escHtml(p.child_name)}</span>` : ''}</span>`).join(' ')}
</div>

${moduleRows.length > 0 ? `
<h2>${pl ? 'Laboratorium Nauki — Odblokowane Moduły' : 'Learning Lab — Unlocked Modules'}</h2>
<div class="module-grid">
  ${moduleRows.map(m => `
  <div class="module-card">
    <div class="mod-name">${escHtml(moduleNames[m.slug] ?? m.slug)}</div>
    <div class="mod-meta">${pl ? 'Uczestnik' : 'Contributor'}: <strong>${escHtml(m.child_name ?? '—')}</strong> &nbsp;·&nbsp; ${pl ? 'Odblokowano' : 'Unlocked'}: ${fmtDate(m.unlocked_at)}</div>
  </div>`).join('')}
</div>` : `<p style="font-size:10px;color:#888;margin-bottom:16px">${pl ? 'Brak odblokowanych modułów.' : 'No modules unlocked yet.'}</p>`}

<h2>${pl ? 'Rejestr transakcji' : 'Transaction Ledger'}</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>${pl ? 'Data' : 'Date'}</th><th>${pl ? 'Opis' : 'Description'}</th>
      <th>${pl ? 'Kategoria' : 'Category'}</th><th>${pl ? 'Kwota' : 'Amount'}</th>
      <th>${pl ? 'Status' : 'Status'}</th>
    </tr>
  </thead>
  <tbody>
    ${ledgerRows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td>${escHtml(r.description)}</td>
      <td>${r.category ? (labelMap[r.category] ?? r.category) : '—'}</td>
      <td class="num-cell">${fmtAmount(r.amount, r.currency)}</td>
      <td><span class="badge-${badgeClass(r.verification_status)}">${statusLabel(r.verification_status, lang)}</span></td>
    </tr>`).join('')}
  </tbody>
</table>

${fingerprintBlock(fingerprint, shortFp, lang)}
${declarationFooter(family.name, exportTs, lang, docUuid, false)}

</body>
</html>`;
}

// ----------------------------------------------------------------
// Version C — Forensic Report (Legal version)
// ----------------------------------------------------------------
interface ForensicContext extends ReportContext {
  completions: CompletionRow[];
  rewardEdits: RewardEditRow[];
  loginRows:   LoginHistoryRow[];
}

function buildForensicReport(ctx: ForensicContext): string {
  const { family, lang, ledgerRows, govRows, completions, rewardEdits, loginRows,
          fingerprint, docUuid, exportTs,
          disputed, totalEarned, totalTasks } = ctx;
  const pl = lang === 'pl';

  const highConf   = completions.filter(c => c.verification_confidence === 'High').length;
  const medConf    = completions.filter(c => c.verification_confidence === 'Medium').length;
  const lowConf    = completions.filter(c => c.verification_confidence === 'Low').length;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>Morechard — ${pl ? 'Łańcuch Dowodów' : 'Chain of Custody'} — ${escHtml(family.name)}</title>
${baseStyles()}
<style>
  body { font-family: 'Courier New', monospace; }
  h1 span.tier-badge { background:#fff3e0; color:#e65100; font-size:12px; padding:2px 10px; border-radius:12px; font-weight:700; letter-spacing:.5px; vertical-align:middle; margin-left:8px; }
  .summary-card { border-left: 4px solid #bf360c; }
  .conf-high   { color: #2e7d32; font-weight:700; }
  .conf-medium { color: #f57f17; font-weight:700; }
  .conf-low    { color: #b71c1c; font-weight:700; }
  .hash-cell   { font-family:monospace; font-size:8px; word-break:break-all; max-width:120px; }
  .integrity-block { margin-top:24px; border:2px solid #bf360c; border-radius:4px; padding:14px; background:#fff8f5; }
  .stat-row td { padding: 3px 8px; border:1px solid #eee; }
</style>
</head>
<body>

<h1>Morechard — ${pl ? 'Niezmienialny Łańcuch Dowodów' : 'Immutable Chain of Custody'} <span class="tier-badge">${pl ? 'WERSJA SĄDOWA' : 'LEGAL VERSION'}</span></h1>
<div class="meta">
  ${pl ? 'Rodzina' : 'Family'}: <strong>${escHtml(family.name)}</strong> &nbsp;|&nbsp;
  ${pl ? 'Wygenerowano' : 'Generated at'}: <strong>${new Date(exportTs * 1000).toISOString()}</strong> &nbsp;|&nbsp;
  ${pl ? 'Waluta' : 'Currency'}: <strong>${family.currency}</strong> &nbsp;|&nbsp;
  UUID: <strong style="font-family:monospace">${docUuid}</strong>
</div>
<p class="report-description" style="border-left:3px solid #bf360c">${pl
  ? 'Dokument zawiera kryptograficznie zabezpieczone dane do celów sądowych i mediacyjnych. Dane GPS i adresy IP są renderowane wyłącznie w tym dokumencie i nigdy nie są przechowywane po stronie klienta.'
  : 'This document contains cryptographically secured data for judicial and mediation purposes. GPS coordinates and IP addresses are rendered exclusively in this document and are never stored client-side.'}</p>

<h2>${pl ? 'Statystyki Weryfikacji' : 'Verification Statistics'}</h2>
<div class="summary-grid">
  <div class="summary-card"><div class="num">${fmtAmount(totalEarned, family.currency)}</div><div class="label">${pl ? 'Łącznie zarobiono' : 'Total Earned'}</div></div>
  <div class="summary-card"><div class="num">${totalTasks}</div><div class="label">${pl ? 'Zapisów w rejestrze' : 'Evidence Log Entries'}</div></div>
  <div class="summary-card"><div class="num conf-high">${highConf}</div><div class="label">${pl ? 'Wysoka pewność' : 'High Confidence'}</div></div>
  <div class="summary-card"><div class="num conf-medium">${medConf}</div><div class="label">${pl ? 'Średnia pewność' : 'Medium Confidence'}</div></div>
  <div class="summary-card"><div class="num conf-low">${lowConf}</div><div class="label">${pl ? 'Niska pewność' : 'Low Confidence'}</div></div>
  <div class="summary-card"><div class="num">${disputed}</div><div class="label">${pl ? 'Zakwestionowanych' : 'Disputed'}</div></div>
</div>

${family.home_lat != null && family.home_lng != null ? `
<h2>${pl ? 'Punkt Odniesienia — Zweryfikowane Gospodarstwo' : 'Verified Household Baseline'}</h2>
<p style="font-size:9px;color:#777;font-style:italic;margin-bottom:8px">${pl
  ? 'Współrzędne domu zarejestrowanego używane jako centrum obliczeń Haversine dla wszystkich odchyleń GPS. Bez tego punktu odległości nie mają sensu.'
  : 'Registered home coordinates used as the Haversine anchor for all GPS variance calculations. Without this fixed point, distances are meaningless.'}</p>
<table style="width:auto">
  <tbody>
    <tr><th>${pl ? 'Szerokość geograficzna' : 'Latitude'}</th><td style="font-family:monospace">${family.home_lat.toFixed(6)}</td></tr>
    <tr><th>${pl ? 'Długość geograficzna' : 'Longitude'}</th><td style="font-family:monospace">${family.home_lng.toFixed(6)}</td></tr>
    <tr><th>${pl ? 'Adres (z rejestracji)' : 'Address (from registration)'}</th><td>${pl ? 'Manchester, Wielka Brytania' : 'Manchester, United Kingdom'}</td></tr>
  </tbody>
</table>` : ''}

<h2>${pl ? 'Rejestr Dowodów z Hashami SHA-256' : 'Evidence Log with SHA-256 Hashes'}</h2>
<p style="font-size:9px;color:#777;font-style:italic;margin-bottom:8px">${pl
  ? 'Każdy wpis zawiera nazwę uczestnika odpowiedzialnego za dane zadanie.'
  : 'Each entry includes the Contributor attributed to the task.'}</p>
<table>
  <thead>
    <tr>
      <th>#</th><th>${pl ? 'Data' : 'Date'}</th>
      <th>${pl ? 'Uczestnik' : 'Contributor'}</th>
      <th>${pl ? 'Opis' : 'Description'}</th>
      <th>${pl ? 'Kwota' : 'Amount'}</th><th>${pl ? 'Status' : 'Status'}</th>
      <th>SHA-256</th>
    </tr>
  </thead>
  <tbody>
    ${ledgerRows.map(r => `
    <tr${r.verification_status === 'disputed' ? ' style="background:#fff5f5"' : ''}>
      <td>${r.id}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td><strong>${escHtml(r.child_name ?? '—')}</strong></td>
      <td>${escHtml(r.description)}</td>
      <td class="num-cell">${fmtAmount(r.amount, r.currency)}</td>
      <td><span class="badge-${badgeClass(r.verification_status)}">${statusLabel(r.verification_status, lang)}</span></td>
      <td class="hash-cell">${escHtml(r.record_hash)}</td>
    </tr>`).join('')}
  </tbody>
</table>

${completions.length > 0 ? `
<h2>${pl ? 'Dowody Wykonania Zadań — Urządzenie, Lokalizacja i Czas Zatwierdzenia' : 'Task Completion Evidence — Device, Location & Approval Latency'}</h2>
<p style="font-size:9px;color:#777;font-style:italic;margin-bottom:8px">${pl
  ? 'Odcisk urządzenia (device_fingerprint) to hash SHA-256 unikalnych identyfikatorów sprzętu — pozwala potwierdzić, że ten sam fizyczny telefon był używany we wszystkich wierszach. Czas oczekiwania na zatwierdzenie pokazuje, ile czasu minęło między przesłaniem a weryfikacją rodzica.'
  : 'Device Fingerprint is a SHA-256 hash of unique hardware identifiers — confirms the same physical handset was used across entries. Approval Latency shows the gap between upload and parental verification.'}</p>
<table>
  <thead>
    <tr>
      <th>#</th><th>${pl ? 'Data' : 'Date'}</th>
      <th>${pl ? 'Uczestnik' : 'Contributor'}</th>
      <th>${pl ? 'Pewność' : 'Confidence'}</th>
      <th>${pl ? 'Odchylenie GPS (km)' : 'GPS Variance (km)'}</th>
      <th>${pl ? 'Lokalizacja sieciowa' : 'Network Location'}</th>
      <th>IP</th>
      <th>${pl ? 'Model urządzenia' : 'Device Model'}</th>
      <th>${pl ? 'Odcisk urządzenia (SHA-256)' : 'Device Fingerprint (SHA-256)'}</th>
      <th>${pl ? 'Czas zatwierdzenia' : 'Approval Latency'}</th>
      <th>${pl ? 'Hash dowodu' : 'Proof Hash'}</th>
    </tr>
  </thead>
  <tbody>
    ${completions.map(c => {
      const latency = c.verified_at != null
        ? fmtLatency(c.verified_at - c.submitted_at)
        : (pl ? 'Brak' : 'Pending');
      const latencyClass = c.verified_at != null && (c.verified_at - c.submitted_at) > 4 * 86400
        ? 'color:#f57f17;font-weight:700'
        : '';
      return `
    <tr${c.verification_confidence === 'Low' ? ' style="background:#fff5f5"' : ''}>
      <td>${c.id}</td>
      <td>${fmtDate(c.submitted_at)}</td>
      <td><strong>${escHtml(c.child_name ?? '—')}</strong></td>
      <td class="conf-${(c.verification_confidence ?? 'low').toLowerCase()}">${escHtml(c.verification_confidence ?? '—')}</td>
      <td>${c.haversine_km != null ? c.haversine_km.toFixed(2) : '—'}</td>
      <td>${escHtml(c.network_city ?? '—')}</td>
      <td style="font-size:9px">${escHtml(c.network_ip ?? '—')}</td>
      <td style="font-size:9px">${escHtml(c.device_model ?? '—')}</td>
      <td class="hash-cell">${escHtml(c.device_fingerprint ?? '—')}</td>
      <td style="font-size:9px;${latencyClass}">${latency}</td>
      <td class="hash-cell">${escHtml(c.proof_hash ?? '—')}</td>
    </tr>`; }).join('')}
  </tbody>
</table>` : ''}

<h2>${pl ? 'Audyt Zarządzania — Pełny Dziennik' : 'Governance Audit — Full Log'}</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>${pl ? 'Data' : 'Date'}</th>
      <th>${pl ? 'Zgłoszono przez' : 'Requested by'}</th>
      <th>${pl ? 'Działanie' : 'Action'}</th>
      <th>${pl ? 'Status' : 'Status'}</th>
      <th>${pl ? 'Zatwierdzone przez' : 'Confirmed by'}</th>
      <th>IP (${pl ? 'żądanie' : 'request'})</th>
      <th>IP (${pl ? 'potwierdzenie' : 'confirm'})</th>
    </tr>
  </thead>
  <tbody>
    ${govRows.map(g => `
    <tr>
      <td>${g.id}</td>
      <td>${fmtDate(g.requested_at)}</td>
      <td>${escHtml(g.requested_by)}</td>
      <td>${g.new_mode === 'amicable'
        ? (pl ? 'Włączono auto-weryfikację' : 'Enabled Auto-Verify')
        : (pl ? 'Włączono ręczną weryfikację' : 'Enabled Manual Approval')}</td>
      <td>${g.status}</td>
      <td>${g.confirmed_by ?? '—'}</td>
      <td style="font-size:9px">${escHtml(g.request_ip)}</td>
      <td style="font-size:9px">${escHtml(g.confirm_ip ?? '—')}</td>
    </tr>`).join('')}
  </tbody>
</table>

${rewardEdits.length > 0 ? `
<h2>${pl ? 'Audyt Zmian Wynagrodzenia' : 'Reward Override Audit'}</h2>
<table>
  <thead>
    <tr>
      <th>${pl ? 'Data' : 'Date'}</th>
      <th>${pl ? 'Zadanie' : 'Chore'}</th>
      <th>${pl ? 'Zatwierdzone przez' : 'Approver'}</th>
      <th>${pl ? 'Poprzednia kwota' : 'Previous Amount'}</th>
      <th>${pl ? 'Nowa kwota' : 'New Amount'}</th>
      <th>${pl ? 'Powód' : 'Reason'}</th>
    </tr>
  </thead>
  <tbody>
    ${rewardEdits.map(e => `
    <tr>
      <td>${fmtDate(e.changed_at)}</td>
      <td>${escHtml(e.chore_id)}</td>
      <td>${escHtml(e.actor_id)}</td>
      <td class="num-cell">${fmtAmount(e.old_amount, family.currency)}</td>
      <td class="num-cell">${fmtAmount(e.new_amount, family.currency)}</td>
      <td>${escHtml(e.reason ?? '—')}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

${loginRows.length > 0 ? `
<h2>${pl ? 'Historia Logowania — Dziennik Dostępu' : 'Login History — Access Log'}</h2>
<p style="font-size:9px;color:#777;font-style:italic;margin-bottom:8px">${pl
  ? 'Każde logowanie i przesłanie dowodu przez dowolnego członka rodziny. Wyłącznie w wersji sądowej.'
  : 'Every login and upload action by any family member. Forensic version only — excluded from standard reports.'}</p>
<table>
  <thead>
    <tr>
      <th>${pl ? 'Data/Godzina' : 'Date / Time'}</th>
      <th>${pl ? 'Użytkownik' : 'User'}</th>
      <th>${pl ? 'Działanie' : 'Action'}</th>
      <th>IP</th>
      <th>${pl ? 'Urządzenie' : 'Device'}</th>
    </tr>
  </thead>
  <tbody>
    ${loginRows.map(l => `
    <tr>
      <td style="white-space:nowrap">${fmtDateTime(l.event_at)}</td>
      <td>${escHtml(l.display_name)}</td>
      <td>${escHtml(l.action)}</td>
      <td style="font-size:9px">${escHtml(l.ip_address)}</td>
      <td style="font-size:9px">${escHtml(l.user_agent ?? '—')}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

<div class="integrity-block">
  <strong>${pl ? 'Pieczęć Integralności Dokumentu' : 'Document Integrity Seal'}</strong><br/>
  <span style="font-family:monospace;font-size:9px">${fingerprint}</span><br/>
  <span style="font-size:9px;color:#555">UUID: ${docUuid}</span>
  <div style="font-size:9px;color:#666;margin-top:6px">${pl
    ? 'Hash SHA-256 jednoznacznie identyfikuje ten eksport. Każda zmiana danych spowoduje inny hash.'
    : 'This SHA-256 hash uniquely identifies this export. Any data change produces a different hash.'}</div>
</div>

${declarationFooter(family.name, exportTs, lang, docUuid, true)}

</body>
</html>`;
}

// ================================================================
// Shared HTML components
// ================================================================

function baseStyles(): string {
  return `<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 13px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 8px; }
  .report-description { font-size:10px; color:#555; margin-bottom:16px; border-left:3px solid #ddd; padding-left:8px; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; }
  .summary-card { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
  .summary-card .num { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .summary-card .label { font-size: 10px; color: #666; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size:10px; }
  th { background: #f5f5f5; text-align: left; padding: 5px 8px; font-size: 10px; border: 1px solid #ddd; }
  td { padding: 4px 8px; border: 1px solid #eee; vertical-align: top; }
  tr:nth-child(even) { background: #fafafa; }
  .num-cell { text-align:right; font-variant-numeric:tabular-nums; }
  .badge-auto     { background: #e8f5e9; color: #2e7d32; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-manual   { background: #e3f2fd; color: #1565c0; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-pending  { background: #fff8e1; color: #f57f17; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-disputed { background: #fce4ec; color: #b71c1c; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-reversed { background: #f3e5f5; color: #6a1b9a; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .warn { color:#b71c1c; font-size:10px; margin-bottom:8px; }
  .fingerprint-block { margin-top:24px; padding:14px; border:1px solid #ccc; border-radius:6px; background:#f9f9f9; }
  .fp { font-family:monospace; font-size:10px; word-break:break-all; margin:4px 0; }
  .qr-placeholder { display:inline-block; width:64px; height:64px; border:1px solid #ccc; text-align:center; line-height:64px; font-size:8px; color:#999; vertical-align:middle; margin-right:12px; }
  .declaration { margin-top:24px; padding:14px; border:2px solid #1a1a1a; border-radius:4px; font-size:10px; line-height:1.6; }
  @media print { body { padding: 16px; } }
</style>`;
}

function fingerprintBlock(fingerprint: string, shortFp: string, lang: string): string {
  const pl = lang === 'pl';
  return `<div class="fingerprint-block">
  <span class="qr-placeholder">QR<br/>${shortFp.slice(0, 8)}</span>
  <span>
    <strong>${pl ? 'Odcisk dokumentu' : 'Document Fingerprint'}:</strong><br/>
    <span class="fp">${fingerprint}</span>
    <div style="font-size:9px;color:#666;margin-top:4px">${pl
      ? 'Ten hash SHA-256 jednoznacznie identyfikuje ten eksport. Każda zmiana danych spowoduje inny hash.'
      : 'This SHA-256 hash uniquely identifies this export. Any data change produces a different hash.'}</div>
  </span>
</div>`;
}

function declarationFooter(
  familyName: string,
  exportTs: number,
  lang: string,
  docUuid: string,
  expanded: boolean,
): string {
  const pl   = lang === 'pl';
  const date = new Date(exportTs * 1000).toDateString();

  const baseText = pl
    ? `Niniejszy dokument zawiera pełny i niezmieniony zapis finansowy rodziny <strong>${escHtml(familyName)}</strong>, wygenerowany przez system Morechard w dniu ${escHtml(date)}.`
    : `This document contains the complete and unaltered financial record for family <strong>${escHtml(familyName)}</strong>, generated by Morechard on ${escHtml(date)}.`;

  // Locale-specific statutory citations — only rendered in forensic (expanded) reports
  const legalCitations = expanded ? (pl
    ? `<br/><br/><strong>Podstawa prawna (Polska):</strong> Niniejszy dokument stanowi zapis komputerowy w rozumieniu art. 308 Kodeksu postępowania cywilnego (k.p.c.), który dopuszcza dowody elektroniczne i komputerowe w postępowaniu cywilnym. Kryptograficzne hashowanie rekordów zapewnia integralność wymaganą dla środków dowodowych w postępowaniach sądowych i mediacyjnych.`
    : `<br/><br/><strong>Legal Basis (United Kingdom):</strong> This document constitutes a computer-produced record under Section 1 of the Civil Evidence Act 1995, which provides for the admissibility of documentary evidence produced by computers. The cryptographic hash chain satisfies the requirement for records to be produced in the course of activities of a regular nature and provides integrity verification consistent with the Act's requirements for computer records tendered in Family Court proceedings.`
  ) : '';

  const expandedSupplement = expanded
    ? `<br/><br/>${pl
        ? `<strong>UUID dokumentu:</strong> <span style="font-family:monospace">${docUuid}</span><br/><strong>Pieczęć integralności:</strong> Każdy wpis w rejestrze jest powiązany z poprzednim via SHA-256 (łańcuch hash). Każda modyfikacja po eksporcie unieważni ten dokument.`
        : `<strong>Document UUID:</strong> <span style="font-family:monospace">${docUuid}</span><br/><strong>Integrity Seal:</strong> Each evidence entry is chained to the previous via SHA-256. Any post-export modification will invalidate this document.`}${legalCitations}`
    : '';

  return `<div class="declaration">
  <strong>${pl ? 'Oświadczenie o dokładności danych' : 'Declaration of Accuracy'}</strong><br/>
  ${baseText}${expandedSupplement}
</div>`;
}

function fmtLatency(seconds: number): string {
  if (seconds < 3600)        return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400)       return `${Math.round(seconds / 3600)}h`;
  const days = Math.round(seconds / 86400);
  return `${days}d`;
}

// ================================================================
// Behavioural pulse derivation
// ================================================================

interface PulseSignal {
  label: string;
  type: 'positive' | 'caution' | 'concern';
  child_name: string | null;
}

function deriveBehaviouralPulse(ledgerRows: LedgerRow[], statusRows: StatusLogRow[], lang: string): PulseSignal[] {
  const pl = lang === 'pl';
  const signals: PulseSignal[] = [];

  // Group by child so each signal is attributed to the specific child
  const childIds = [...new Set(ledgerRows.map(r => r.child_id ?? '').filter(Boolean))];

  for (const childId of childIds) {
    const childRows = ledgerRows.filter(r => r.child_id === childId);
    const childName = childRows[0]?.child_name ?? null;

    const credits  = childRows.filter(r => r.entry_type === 'credit');
    const payments = childRows.filter(r => r.entry_type === 'payment');
    const disputed = childRows.filter(r => r.verification_status === 'disputed');

    // Stagnant Earner — fewer than 2 credits in last 30 days
    const cutoff30 = Math.floor(Date.now() / 1000) - 30 * 86400;
    const recent   = credits.filter(r => r.created_at > cutoff30).length;
    if (credits.length > 4 && recent < 2) {
      signals.push({ label: pl ? 'Stagnujący zarabiacz' : 'Stagnant Earner', type: 'concern', child_name: childName });
    }

    // The Burner — high spend-to-earn ratio
    const earnedMinor = credits.reduce((s, r) => s + r.amount, 0);
    const spentMinor  = payments.reduce((s, r) => s + r.amount, 0);
    if (earnedMinor > 0 && spentMinor / earnedMinor > 0.8) {
      signals.push({ label: pl ? 'Wydający wszystko' : 'The Burner', type: 'concern', child_name: childName });
    } else if (earnedMinor > 0 && spentMinor / earnedMinor < 0.3 && earnedMinor > 500) {
      signals.push({ label: pl ? 'Regularny oszczędzający' : 'Consistent Saver', type: 'positive', child_name: childName });
    }

    // Dispute rate
    if (disputed.length > 0 && credits.length > 0 && disputed.length / credits.length > 0.2) {
      signals.push({ label: pl ? 'Wysoki wskaźnik sporów' : 'High Dispute Rate', type: 'concern', child_name: childName });
    }

    // Steady contributor
    if (credits.length >= 10 && disputed.length === 0) {
      signals.push({ label: pl ? 'Stały uczestnik' : 'Steady Contributor', type: 'positive', child_name: childName });
    }
  }

  // Revision pattern — family-wide (status log doesn't carry child_id directly)
  const revisions = statusRows.filter(s => s.to_status === 'pending' && s.from_status !== 'pending').length;
  if (revisions > 2) {
    signals.push({ label: pl ? 'Potrzeba poprawy' : 'Needs Revision Pattern', type: 'caution', child_name: null });
  }

  if (signals.length === 0) {
    signals.push({ label: pl ? 'Brak danych do analizy' : 'Insufficient data for pulse', type: 'caution', child_name: null });
  }

  return signals;
}

// ================================================================
// Helpers
// ================================================================

type ReportTier = 'basic' | 'behavioral' | 'forensic';

interface LabelRow  { code: string; label_en: string; label_pl: string; }
interface FamilyRow {
  id: string; name: string; currency: string; verify_mode: string;
  // Registered home coordinates — used as Haversine anchor, stored in families table
  home_lat: number | null; home_lng: number | null;
}
interface LedgerRow {
  id: number; created_at: number; entry_type: string; description: string;
  child_id: string | null; category: string | null; amount: number; currency: string;
  verification_status: string; dispute_code: string | null; record_hash: string;
  // Joined from users
  child_name: string | null;
}
interface GovRow {
  id: number; requested_at: number; requested_by: string; new_mode: string;
  status: string; confirmed_by: string | null; request_ip: string; confirm_ip: string | null;
}
interface StatusLogRow {
  id: number; ledger_id: number; from_status: string; to_status: string;
  actor_id: string; created_at: number;
}
interface CompletionRow {
  id: number; chore_id: string; child_id: string;
  // child_name joined from users
  child_name: string | null;
  submitted_at: number;
  // verified_at for approval latency calculation
  verified_at: number | null;
  proof_hash: string | null; verification_confidence: string | null;
  haversine_km: number | null; network_city: string | null; network_ip: string | null;
  device_model: string | null; user_agent: string | null;
  // Hashed device fingerprint — identifies specific physical device, not just model
  device_fingerprint: string | null;
}
interface LearningModuleRow {
  slug: string; unlocked_at: number; child_id: string;
  // child_name joined from users
  child_name: string | null;
}
interface RewardEditRow {
  actor_id: string; chore_id: string; old_amount: number; new_amount: number;
  changed_at: number; reason: string | null;
}
interface LoginHistoryRow {
  display_name: string; event_at: number; ip_address: string;
  user_agent: string | null; role: string; action: string;
}

function buildLabelMap(rows: LabelRow[], lang: string): Record<string, string> {
  return Object.fromEntries(rows.map(r => [r.code, lang === 'pl' ? r.label_pl : r.label_en]));
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function fmtDateTime(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtAmount(pence: number, currency: string): string {
  const major = (pence / 100).toFixed(2);
  if (currency === 'GBP') return `£${major}`;
  if (currency === 'PLN') return `${major} zł`;
  return `$${major}`;
}

function badgeClass(status: string): string {
  if (status === 'verified_auto')   return 'auto';
  if (status === 'verified_manual') return 'manual';
  if (status === 'disputed')        return 'disputed';
  if (status === 'reversed')        return 'reversed';
  return 'pending';
}

function statusLabel(status: string, lang: string): string {
  const pl = lang === 'pl';
  const map: Record<string, [string, string]> = {
    'pending':          ['Oczekujący',         'Pending'],
    'verified_auto':    ['Zweryfikowany auto',  'Verified (Auto)'],
    'verified_manual':  ['Zweryfikowany ręcznie','Verified (Manual)'],
    'disputed':         ['Zakwestionowany',     'Disputed'],
    'reversed':         ['Wycofany',            'Reversed'],
  };
  const pair = map[status];
  return pair ? (pl ? pair[0] : pair[1]) : status;
}
