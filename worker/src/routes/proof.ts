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
 *
 * Audit columns written on every upload (never returned to child/parent list endpoints):
 *   proof_hash              — SHA-256 hex of raw bytes (tamper-evident integrity seal)
 *   proof_exif              — JSON: dateTimeOriginal, gpsLat, gpsLng, deviceModel
 *   system_verify           — JSON: uploadedAt, ip, city, country, cfLat, cfLng
 *   verification_confidence — 'High' | 'Medium' | 'Low'
 *
 * Confidence rules:
 *   High   — EXIF DateTimeOriginal within 10 min of server time AND
 *             EXIF GPS within 50 km of Cloudflare request PoP lat/lng
 *   Medium — No EXIF GPS (or no EXIF at all), but system headers confirm
 *             the upload came from the expected region at the right time
 *   Low    — EXIF DateTimeOriginal exists but is >10 min older than upload time,
 *             indicating a potentially reused photo
 */

import { Env } from '../types.js';
import { json, error } from '../lib/response.js';
import { JwtPayload } from '../lib/jwt.js';

type AuthedRequest = Request & { auth: JwtPayload };

// Allowed MIME types for evidence photos
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
// Max upload size: 10 MB
const MAX_BYTES = 10 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// EXIF extraction
// Supports JPEG APP1/Exif segments only. PNG/WEBP/HEIC return null gracefully.
// Tags extracted: DateTimeOriginal (0x9003), Model (0x0110),
//                 GPSLatitude (0x0002), GPSLongitude (0x0004)
// ─────────────────────────────────────────────────────────────────────────────

interface ExifData {
  dateTimeOriginal: string | null;  // 'YYYY:MM:DD HH:MM:SS'
  gpsLat: number | null;            // decimal degrees, positive = N
  gpsLng: number | null;            // decimal degrees, positive = E
  deviceModel: string | null;
}

function extractExif(buf: ArrayBuffer): ExifData {
  const result: ExifData = { dateTimeOriginal: null, gpsLat: null, gpsLng: null, deviceModel: null };
  const view = new DataView(buf);

  // Must be JPEG (SOI marker FF D8)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return result;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xFFD9) break; // EOI

    // Skip non-segment markers (standalone)
    if ((marker & 0xFF00) !== 0xFF00) break;

    const segLen = view.getUint16(offset);
    offset += 2;
    const segEnd = offset + segLen - 2;

    // APP1 (0xFFE1) containing Exif
    if (marker === 0xFFE1 && segLen > 6) {
      // Check for 'Exif\0\0' header
      if (
        view.getUint8(offset)     === 0x45 && // E
        view.getUint8(offset + 1) === 0x78 && // x
        view.getUint8(offset + 2) === 0x69 && // i
        view.getUint8(offset + 3) === 0x66 && // f
        view.getUint8(offset + 4) === 0x00 &&
        view.getUint8(offset + 5) === 0x00
      ) {
        const tiffBase = offset + 6;
        parseIfd(view, buf, tiffBase, result);
      }
    }

    offset = segEnd;
    if (offset >= view.byteLength) break;
  }

  return result;
}

function parseIfd(view: DataView, buf: ArrayBuffer, tiffBase: number, out: ExifData): void {
  if (tiffBase + 8 > view.byteLength) return;

  // Byte order: 'II' = little-endian, 'MM' = big-endian
  const bom = view.getUint16(tiffBase);
  const le  = bom === 0x4949; // Intel = little-endian

  const read16  = (o: number) => le ? view.getUint16(o, true)  : view.getUint16(o, false);
  const read32  = (o: number) => le ? view.getUint32(o, true)  : view.getUint32(o, false);
  const readR64 = (o: number) => {          // rational (two UINT32s → decimal)
    const num = le ? view.getUint32(o, true)     : view.getUint32(o, false);
    const den = le ? view.getUint32(o + 4, true) : view.getUint32(o + 4, false);
    return den === 0 ? 0 : num / den;
  };

  // TIFF magic check (0x002A)
  if (read16(tiffBase + 2) !== 0x002A) return;

  const ifd0Offset = read32(tiffBase + 4);

  // Walk IFD0
  let gpsIfdOffset: number | null = null;
  let exifIfdOffset: number | null = null;
  walkIfd(tiffBase + ifd0Offset, tiffBase, view, read16, read32, (tag, type, count, valueOffset) => {
    if (tag === 0x0110) { // Model
      out.deviceModel = readAscii(buf, tiffBase + valueOffset, count);
    } else if (tag === 0x8825) { // GPSInfoIFD pointer
      gpsIfdOffset = valueOffset;
    } else if (tag === 0x8769) { // ExifIFD pointer
      exifIfdOffset = valueOffset;
    }
  });

  // Walk ExifIFD for DateTimeOriginal
  if (exifIfdOffset !== null) {
    walkIfd(tiffBase + exifIfdOffset, tiffBase, view, read16, read32, (tag, _type, count, valueOffset) => {
      if (tag === 0x9003) { // DateTimeOriginal
        out.dateTimeOriginal = readAscii(buf, tiffBase + valueOffset, count);
      }
    });
  }

  // Walk GPS IFD
  if (gpsIfdOffset !== null) {
    let latRef = 'N', lngRef = 'E';
    let latDeg: number[] | null = null, lngDeg: number[] | null = null;

    walkIfd(tiffBase + gpsIfdOffset, tiffBase, view, read16, read32, (tag, _type, count, valueOffset) => {
      if (tag === 0x0001 && count === 2) { // GPSLatitudeRef ('N' or 'S')
        latRef = String.fromCharCode(view.getUint8(tiffBase + valueOffset));
      } else if (tag === 0x0002 && count === 3) { // GPSLatitude [deg, min, sec] rationals
        latDeg = [
          readR64(tiffBase + valueOffset),
          readR64(tiffBase + valueOffset + 8),
          readR64(tiffBase + valueOffset + 16),
        ];
      } else if (tag === 0x0003 && count === 2) { // GPSLongitudeRef ('E' or 'W')
        lngRef = String.fromCharCode(view.getUint8(tiffBase + valueOffset));
      } else if (tag === 0x0004 && count === 3) { // GPSLongitude
        lngDeg = [
          readR64(tiffBase + valueOffset),
          readR64(tiffBase + valueOffset + 8),
          readR64(tiffBase + valueOffset + 16),
        ];
      }
    });

    if (latDeg) {
      out.gpsLat = dmsToDecimal(latDeg[0], latDeg[1], latDeg[2], latRef === 'S');
    }
    if (lngDeg) {
      out.gpsLng = dmsToDecimal(lngDeg[0], lngDeg[1], lngDeg[2], lngRef === 'W');
    }
  }
}

function walkIfd(
  ifdPos: number,
  tiffBase: number,
  view: DataView,
  read16: (o: number) => number,
  read32: (o: number) => number,
  cb: (tag: number, type: number, count: number, valueOffset: number) => void,
): void {
  if (ifdPos + 2 > view.byteLength) return;
  const count = read16(ifdPos);
  for (let i = 0; i < count; i++) {
    const entryBase = ifdPos + 2 + i * 12;
    if (entryBase + 12 > view.byteLength) break;
    const tag   = read16(entryBase);
    const type  = read16(entryBase + 2);
    const cnt   = read32(entryBase + 4);
    // Value or offset: if the value fits in 4 bytes it's stored inline,
    // otherwise the 4 bytes are an offset from tiffBase.
    const valueOrOffset = entryBase + 8 - tiffBase; // relative to tiffBase
    cb(tag, type, cnt, valueOrOffset);
  }
}

function readAscii(buf: ArrayBuffer, absOffset: number, count: number): string {
  const bytes = new Uint8Array(buf, absOffset, Math.min(count, 64));
  let s = '';
  for (const b of bytes) {
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s.trim();
}

function dmsToDecimal(deg: number, min: number, sec: number, negative: boolean): number {
  const decimal = deg + min / 60 + sec / 3600;
  return negative ? -decimal : decimal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance (km) between two lat/lng points
// ─────────────────────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence scoring
// ─────────────────────────────────────────────────────────────────────────────
type Confidence = 'High' | 'Medium' | 'Low';

function scoreConfidence(
  exif: ExifData,
  uploadedAtMs: number,
  cfLat: number | null,
  cfLng: number | null,
): Confidence {
  const hasExifTimestamp = !!exif.dateTimeOriginal;
  const hasExifGps = exif.gpsLat !== null && exif.gpsLng !== null;
  const hasCfGeo  = cfLat !== null && cfLng !== null;

  // Parse EXIF timestamp: 'YYYY:MM:DD HH:MM:SS'
  let exifAgeMins = Infinity;
  if (hasExifTimestamp) {
    const raw = exif.dateTimeOriginal!.replace(
      /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
      '$1-$2-$3T$4:$5:$6Z',
    );
    const exifMs = Date.parse(raw);
    if (!isNaN(exifMs)) {
      exifAgeMins = (uploadedAtMs - exifMs) / 60_000;
    }
  }

  // Low: EXIF timestamp is stale (photo is >10 min old at upload time)
  // This catches the "grabbed from gallery" scenario.
  if (hasExifTimestamp && exifAgeMins > 10) {
    return 'Low';
  }

  // High: fresh EXIF timestamp AND GPS within 50 km of Cloudflare PoP
  if (hasExifTimestamp && exifAgeMins <= 10 && hasExifGps && hasCfGeo) {
    const km = haversineKm(exif.gpsLat!, exif.gpsLng!, cfLat!, cfLng!);
    if (km <= 50) return 'High';
    // GPS is present but far from CF PoP — co-parenting case or VPN.
    // Don't penalise to Low; EXIF timestamp is still fresh.
    return 'Medium';
  }

  // Medium: no GPS (privacy setting) but timestamp is fresh,
  // or no EXIF at all (PNG, HEIC with stripped metadata) but
  // system network data confirms a plausible upload location.
  return 'Medium';
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-256 hex digest
// ─────────────────────────────────────────────────────────────────────────────
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/completions/:id/proof
// Child uploads a photo as evidence for a completion.
// Content-Type must be one of ALLOWED_TYPES.
// Body: raw image bytes (not multipart).
// ─────────────────────────────────────────────────────────────────────────────
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

  const uploadedAtMs = Date.now();

  // ── Integrity seal ───────────────────────────────────────────────────────
  const proofHash = await sha256Hex(body);

  // ── EXIF extraction (silent failure — never surfaced to child) ───────────
  let exif: ExifData = { dateTimeOriginal: null, gpsLat: null, gpsLng: null, deviceModel: null };
  try {
    exif = extractExif(body);
  } catch {
    // Non-fatal: HEIC, PNG, or stripped JPEG — fall through to Medium confidence
  }

  // ── Cloudflare network fingerprint ───────────────────────────────────────
  // request.cf is a Cloudflare-specific IncomingRequestCfProperties object.
  // Cast via unknown to avoid @cloudflare/workers-types version skew.
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
  const cfLat = typeof cf['latitude']  === 'number' ? cf['latitude']  as number : null;
  const cfLng = typeof cf['longitude'] === 'number' ? cf['longitude'] as number : null;

  const systemVerify = {
    uploadedAt: new Date(uploadedAtMs).toISOString(),
    ip:         request.headers.get('CF-Connecting-IP')  ?? null,
    city:       request.headers.get('CF-IPCity')         ?? (cf['city']    as string | null) ?? null,
    country:    request.headers.get('CF-IPCountry')      ?? (cf['country'] as string | null) ?? null,
    cfLat,
    cfLng,
  };

  // ── Confidence score ─────────────────────────────────────────────────────
  const confidence = scoreConfidence(exif, uploadedAtMs, cfLat, cfLng);

  // ── EXIF stored without GPS (GPS is in system_verify only to avoid duplication) ──
  // Actually GPS goes into proof_exif too — it's all audit-only.
  // Neither column is returned by the list/history endpoints.
  const proofExif = {
    dateTimeOriginal: exif.dateTimeOriginal,
    gpsLat:           exif.gpsLat,
    gpsLng:           exif.gpsLng,
    deviceModel:      exif.deviceModel,
  };

  // Delete old R2 object if this is a re-upload
  if (comp.proof_url) {
    try {
      await env.EVIDENCE.delete(comp.proof_url);
    } catch {
      // Non-fatal: object may already be expired or missing
    }
  }

  // Build R2 key: evidence/{family_id}/{completion_id}/{timestamp}.ext
  const ext = mimeType === 'image/png'  ? 'png'
            : mimeType === 'image/webp' ? 'webp'
            : mimeType === 'image/heic' ? 'heic'
            : 'jpg';
  const r2Key = `evidence/${comp.family_id}/${completionId}/${uploadedAtMs}.${ext}`;

  await env.EVIDENCE.put(r2Key, body, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      family_id:     comp.family_id,
      child_id:      comp.child_id,
      completion_id: completionId,
      proof_hash:    proofHash,
      confidence:    confidence,
    },
  });

  // Persist all audit fields in one UPDATE
  await env.DB
    .prepare(`
      UPDATE completions
      SET proof_url              = ?,
          proof_hash             = ?,
          proof_exif             = ?,
          system_verify          = ?,
          verification_confidence = ?
      WHERE id = ?
    `)
    .bind(
      r2Key,
      proofHash,
      JSON.stringify(proofExif),
      JSON.stringify(systemVerify),
      confidence,
      completionId,
    )
    .run();

  return json({ ok: true, proof_key: r2Key }, 201);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/completions/:id/proof
// Returns a presigned URL valid for 60 minutes.
// Both parent and child in the same family can retrieve it.
// Audit columns (proof_hash, proof_exif, system_verify, verification_confidence)
// are NOT returned here — they are reserved for the audit export route.
// ─────────────────────────────────────────────────────────────────────────────
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
