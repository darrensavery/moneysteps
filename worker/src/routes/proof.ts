/**
 * Proof-of-work photo routes (R2)
 *
 * POST   /api/completions/:id/proof   Child uploads evidence photo → stored in R2
 * GET    /api/completions/:id/proof   Parent/child gets a presigned URL (60-min expiry)
 *
 * R2 key format: evidence/{family_id}/{completion_id}/{timestamp}.jpg
 * Lifecycle: R2 bucket policy handles 90-day auto-deletion (configured in Cloudflare dashboard).
 * If a child re-uploads (after needs_revision), the old R2 object is deleted first.
 *
 * The frontend should handle missing images gracefully — after 90 days
 * the presigned URL will return 404 and the UI should show "Evidence expired".
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

// Allowed MIME types for evidence photos
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
// Max upload size: 10 MB
const MAX_BYTES = 10 * 1024 * 1024;

// ----------------------------------------------------------------
// POST /api/completions/:id/proof
// Child uploads a photo as evidence for a completion.
// Content-Type must be one of ALLOWED_TYPES.
// Body: raw image bytes (not multipart).
//
// If proof_url already exists on the completion (resubmission after
// needs_revision), the old R2 object is deleted first.
// ----------------------------------------------------------------
export async function handleProofUpload(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;
  if (auth.role !== 'child') return error('Only children can upload proof', 403);

  const contentType = request.headers.get('content-type') ?? '';
  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return error(`Unsupported file type. Allowed: ${ALLOWED_TYPES.join(', ')}`, 415);
  }

  // Fetch completion — must belong to this child and be awaiting_review or needs_revision
  const comp = await env.DB
    .prepare('SELECT * FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{
      id: string; family_id: string; child_id: string;
      status: string; proof_url: string | null;
    }>();

  if (!comp) return error('Completion not found', 404);
  if (comp.family_id !== auth.family_id) return error('Forbidden', 403);
  if (comp.child_id !== auth.sub) return error('Not your completion', 403);

  const allowedStatuses = ['awaiting_review', 'needs_revision'];
  if (!allowedStatuses.includes(comp.status))
    return error(`Cannot upload proof — completion is '${comp.status}'`, 409);

  // Size check
  const contentLength = parseInt(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BYTES) return error('File too large (max 10 MB)', 413);

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return error('File too large (max 10 MB)', 413);
  if (body.byteLength === 0) return error('Empty file', 400);

  // Delete old R2 object if this is a re-upload
  if (comp.proof_url) {
    try {
      await env.EVIDENCE.delete(comp.proof_url);
    } catch {
      // Non-fatal: object may already be expired or missing
    }
  }

  // Build R2 key: evidence/{family_id}/{completion_id}/{timestamp}.ext
  const ext = mimeType === 'image/png' ? 'png'
             : mimeType === 'image/webp' ? 'webp'
             : mimeType === 'image/heic' ? 'heic'
             : 'jpg';
  const r2Key = `evidence/${comp.family_id}/${completionId}/${Date.now()}.${ext}`;

  await env.EVIDENCE.put(r2Key, body, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      family_id: comp.family_id,
      child_id: comp.child_id,
      completion_id: completionId,
    },
  });

  // Persist the R2 key on the completion row
  await env.DB
    .prepare('UPDATE completions SET proof_url = ? WHERE id = ?')
    .bind(r2Key, completionId)
    .run();

  return json({ ok: true, proof_key: r2Key }, 201);
}

// ----------------------------------------------------------------
// GET /api/completions/:id/proof
// Returns a presigned URL valid for 60 minutes.
// Both parent and child in the same family can retrieve it.
// ----------------------------------------------------------------
export async function handleProofGet(
  request: Request,
  env: Env,
  completionId: string,
): Promise<Response> {
  const auth = (request as AuthedRequest).auth;

  const comp = await env.DB
    .prepare('SELECT family_id, child_id, proof_url FROM completions WHERE id = ?')
    .bind(completionId)
    .first<{ family_id: string; child_id: string; proof_url: string | null }>();

  if (!comp) return error('Completion not found', 404);
  if (comp.family_id !== auth.family_id) return error('Forbidden', 403);

  if (!comp.proof_url) return json({ proof_url: null, message: 'No evidence uploaded yet' });

  // Check object still exists (may have expired via R2 lifecycle policy)
  const obj = await env.EVIDENCE.head(comp.proof_url);
  if (!obj) {
    return json({
      proof_url: null,
      message: 'Evidence photo has expired (90-day retention policy)',
      expired: true,
    });
  }

  // Generate presigned URL — 3600 seconds (1 hour)
  // createSignedUrl is a Cloudflare R2 runtime method not yet reflected in workers-types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedUrl = await (env.EVIDENCE as unknown as any).createSignedUrl(comp.proof_url, {
    expiresIn: 3600,
  });

  return json({ proof_url: signedUrl, expires_in: 3600 });
}
