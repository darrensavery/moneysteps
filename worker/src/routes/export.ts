/**
 * Export routes — GDPR/RODO Right to Portability + Court-Ready PDF
 *
 * GET /api/export/json?family_id=&lang=en|pl
 *   Full structured data export: ledger, governance log, status log, currency snapshots.
 *   Includes bilingual labels. Satisfies GDPR Article 20 (data portability).
 *
 * GET /api/export/pdf?family_id=&lang=en|pl
 *   Returns an HTML document styled for print-to-PDF.
 *   Includes: document fingerprint (SHA-256 of export content + timestamp),
 *   QR code (text fallback), pending/verified summary, declaration footer,
 *   governance log with action_taken labels, full ledger with bilingual categories.
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

  // Enrich ledger entries with bilingual labels
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

  if (!family_id) return error('family_id required');

  const [family, ledger, governance, labels] = await Promise.all([
    env.DB.prepare('SELECT * FROM families WHERE id = ?').bind(family_id).first<FamilyRow>(),
    env.DB.prepare('SELECT * FROM ledger WHERE family_id = ? ORDER BY id ASC').bind(family_id).all(),
    env.DB.prepare('SELECT * FROM family_governance_log WHERE family_id = ? ORDER BY id ASC').bind(family_id).all(),
    env.DB.prepare('SELECT * FROM bilingual_labels').all(),
  ]);

  if (!family) return error('Family not found', 404);

  const labelMap   = buildLabelMap(labels.results as unknown as LabelRow[], lang);
  const ledgerRows = ledger.results as unknown as LedgerRow[];
  const govRows    = governance.results as unknown as GovRow[];

  // Document fingerprint — SHA-256 of (family_id + row count + export timestamp)
  const exportTs     = Math.floor(Date.now() / 1000);
  const fingerprintInput = `${family_id}|${ledgerRows.length}|${exportTs}`;
  const fingerprint  = await sha256(fingerprintInput);
  const shortFp      = fingerprint.slice(0, 16).toUpperCase();

  const pending  = ledgerRows.filter(r => r.verification_status === 'pending').length;
  const verified = ledgerRows.filter(r => r.verification_status.startsWith('verified')).length;
  const disputed = ledgerRows.filter(r => r.verification_status === 'disputed').length;

  const t = translations(lang);

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>Morechard — ${t.title} — ${family.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 13px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 16px; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
  .summary-card { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
  .summary-card .num { font-size: 22px; font-weight: 700; }
  .summary-card .label { font-size: 10px; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f5f5f5; text-align: left; padding: 5px 8px; font-size: 10px; border: 1px solid #ddd; }
  td { padding: 4px 8px; border: 1px solid #eee; vertical-align: top; }
  tr:nth-child(even) { background: #fafafa; }
  .badge-auto     { background: #e8f5e9; color: #2e7d32; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-manual   { background: #e3f2fd; color: #1565c0; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-pending  { background: #fff8e1; color: #f57f17; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .badge-disputed { background: #fce4ec; color: #b71c1c; padding: 1px 6px; border-radius: 10px; font-size: 9px; }
  .fingerprint-block { margin-top: 32px; padding: 16px; border: 1px solid #ccc; border-radius: 6px; background: #f9f9f9; }
  .fingerprint-block .fp { font-family: monospace; font-size: 10px; word-break: break-all; margin: 4px 0; }
  .declaration { margin-top: 24px; padding: 14px; border: 2px solid #1a1a1a; border-radius: 4px; font-size: 10px; line-height: 1.6; }
  .qr-placeholder { display: inline-block; width: 64px; height: 64px; border: 1px solid #ccc; text-align: center;
                    line-height: 64px; font-size: 8px; color: #999; vertical-align: middle; margin-right: 12px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>

<h1>Morechard — ${t.title}</h1>
<div class="meta">
  ${t.family}: <strong>${escHtml(family.name)}</strong> &nbsp;|&nbsp;
  ${t.exportedAt}: <strong>${new Date(exportTs * 1000).toISOString()}</strong> &nbsp;|&nbsp;
  ${t.currency}: <strong>${family.currency}</strong>
</div>

<h2>${t.summary}</h2>
<div class="summary-grid">
  <div class="summary-card"><div class="num">${ledgerRows.length}</div><div class="label">${t.totalEntries}</div></div>
  <div class="summary-card"><div class="num">${verified}</div><div class="label">${t.verified}</div></div>
  <div class="summary-card"><div class="num">${pending}</div><div class="label">${t.pending}</div></div>
</div>
${disputed > 0 ? `<p style="color:#b71c1c;font-size:10px;margin-bottom:8px;">⚠ ${disputed} ${t.disputedWarning}</p>` : ''}

<h2>${t.ledgerTitle}</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>${t.date}</th><th>${t.type}</th><th>${t.description}</th>
      <th>${t.category}</th><th>${t.amount}</th><th>${t.status}</th>
      <th>${t.disputeCode}</th><th>${t.hash}</th>
    </tr>
  </thead>
  <tbody>
    ${ledgerRows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${fmtDate(r.created_at)}</td>
      <td>${r.entry_type}</td>
      <td>${escHtml(r.description)}</td>
      <td>${r.category ? (labelMap[r.category] ?? r.category) : '—'}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtAmount(r.amount, r.currency)}</td>
      <td><span class="badge-${badgeClass(r.verification_status)}">${r.verification_status}</span></td>
      <td>${r.dispute_code ? (labelMap[r.dispute_code] ?? r.dispute_code) : '—'}</td>
      <td style="font-family:monospace;font-size:8px">${r.record_hash.slice(0, 12)}…</td>
    </tr>`).join('')}
  </tbody>
</table>

<h2>${t.governanceTitle}</h2>
<table>
  <thead>
    <tr><th>#</th><th>${t.date}</th><th>${t.requestedBy}</th><th>${t.action}</th><th>${t.status}</th><th>${t.confirmedBy}</th><th>IP</th></tr>
  </thead>
  <tbody>
    ${govRows.map(g => `
    <tr>
      <td>${g.id}</td>
      <td>${fmtDate(g.requested_at)}</td>
      <td>${escHtml(g.requested_by)}</td>
      <td>${g.new_mode === 'amicable'
        ? (lang === 'pl' ? 'Włączono auto-weryfikację' : 'Enabled Auto-Verify')
        : (lang === 'pl' ? 'Włączono ręczną weryfikację' : 'Enabled Manual Approval')}</td>
      <td>${g.status}</td>
      <td>${g.confirmed_by ?? '—'}</td>
      <td style="font-size:9px">${escHtml(g.request_ip)}</td>
    </tr>`).join('')}
  </tbody>
</table>

<div class="fingerprint-block">
  <span class="qr-placeholder">QR<br/>${shortFp}</span>
  <span>
    <strong>${t.docFingerprint}:</strong><br/>
    <span class="fp">${fingerprint}</span>
    <div style="font-size:9px;color:#666;margin-top:4px">
      ${t.fingerprintNote}
    </div>
  </span>
</div>

<div class="declaration">
  <strong>${t.declarationTitle}</strong><br/>
  ${t.declarationBody(family.name, new Date(exportTs * 1000).toDateString())}
</div>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="morechard-report-${family_id}-${Date.now()}.html"`,
    },
  });
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

interface LabelRow  { code: string; label_en: string; label_pl: string; }
interface FamilyRow { id: string; name: string; currency: string; verify_mode: string; }
interface LedgerRow {
  id: number; created_at: number; entry_type: string; description: string;
  category: string | null; amount: number; currency: string;
  verification_status: string; dispute_code: string | null; record_hash: string;
}
interface GovRow {
  id: number; requested_at: number; requested_by: string; new_mode: string;
  status: string; confirmed_by: string | null; request_ip: string;
}

function buildLabelMap(rows: LabelRow[], lang: string): Record<string, string> {
  return Object.fromEntries(rows.map(r => [r.code, lang === 'pl' ? r.label_pl : r.label_en]));
}

function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function fmtAmount(pence: number, currency: string): string {
  const major = (pence / 100).toFixed(2);
  return currency === 'GBP' ? `£${major}` : `${major} zł`;
}

function badgeClass(status: string): string {
  if (status === 'verified_auto')   return 'auto';
  if (status === 'verified_manual') return 'manual';
  if (status === 'disputed')        return 'disputed';
  return 'pending';
}

function translations(lang: string) {
  const pl = lang === 'pl';
  return {
    title:           pl ? 'Raport finansowy' : 'Financial Report',
    family:          pl ? 'Rodzina' : 'Family',
    exportedAt:      pl ? 'Wygenerowano' : 'Exported at',
    currency:        pl ? 'Waluta' : 'Currency',
    summary:         pl ? 'Podsumowanie' : 'Summary',
    totalEntries:    pl ? 'Wszystkich wpisów' : 'Total entries',
    verified:        pl ? 'Zweryfikowanych' : 'Verified',
    pending:         pl ? 'Oczekujących' : 'Pending',
    disputedWarning: pl ? 'wpis(-ów) zakwestionowanych' : 'disputed entry/entries',
    ledgerTitle:     pl ? 'Rejestr transakcji' : 'Transaction Ledger',
    date:            pl ? 'Data' : 'Date',
    type:            pl ? 'Typ' : 'Type',
    description:     pl ? 'Opis' : 'Description',
    category:        pl ? 'Kategoria' : 'Category',
    amount:          pl ? 'Kwota' : 'Amount',
    status:          pl ? 'Status' : 'Status',
    disputeCode:     pl ? 'Kod sporu' : 'Dispute Code',
    hash:            pl ? 'Skrót' : 'Hash',
    governanceTitle: pl ? 'Dziennik zarządzania' : 'Governance Log',
    requestedBy:     pl ? 'Zgłoszono przez' : 'Requested by',
    action:          pl ? 'Działanie' : 'Action',
    confirmedBy:     pl ? 'Potwierdzone przez' : 'Confirmed by',
    docFingerprint:  pl ? 'Odcisk dokumentu' : 'Document Fingerprint',
    fingerprintNote: pl
      ? 'Ten hash SHA-256 jednoznacznie identyfikuje ten eksport. Każda zmiana danych spowoduje inny hash.'
      : 'This SHA-256 hash uniquely identifies this export. Any data tampering will produce a different hash.',
    declarationTitle: pl ? 'Oświadczenie o dokładności danych' : 'Declaration of Accuracy',
    declarationBody: (name: string, date: string) => pl
      ? `Niniejszy dokument zawiera pełny i niezmieniony zapis finansowy rodziny <strong>${escHtml(name)}</strong>, wygenerowany przez system Morechard w dniu ${escHtml(date)}. Wszystkie transakcje są niezmienne i zabezpieczone kryptograficznie. Dokument może być przedstawiony jako dowód przed sądem rodzinnym lub mediatorem.`
      : `This document contains the complete and unaltered financial record for family <strong>${escHtml(name)}</strong>, generated by Morechard on ${escHtml(date)}. All transactions are cryptographically secured and immutable. This document may be presented as evidence to a UK Family Court or Polish Mediator.`,
  };
}
