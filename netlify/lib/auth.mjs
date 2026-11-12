import crypto from 'node:crypto';

const SESSION_TTL = 8 * 60 * 60; // portal sign-in lasts a working day

// --- Passwords -------------------------------------------------------------
// Stored as scrypt:<N>:<r>:<p>:<salt>:<hash> so cost parameters can be raised
// later without invalidating existing hashes.
export function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':');
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, N, r, p, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: +N, r: +r, p: +p,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// The admin password comes from the environment: ADMIN_PASSWORD_HASH (from
// scripts/hash-password.mjs) if set, otherwise plain ADMIN_PASSWORD as entered
// in the Netlify deploy form. Both sides are hashed first so the compare is
// constant-time whatever the lengths.
const MIN_ADMIN_PASSWORD = 12;

export function adminPasswordConfigured() {
  return !!process.env.ADMIN_PASSWORD_HASH || (process.env.ADMIN_PASSWORD || '').length >= MIN_ADMIN_PASSWORD;
}

export function verifyAdminPassword(password) {
  if (process.env.ADMIN_PASSWORD_HASH) return verifyPassword(password, process.env.ADMIN_PASSWORD_HASH);
  const plain = process.env.ADMIN_PASSWORD;
  if (!plain || plain.length < MIN_ADMIN_PASSWORD) return false;
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(digest(password), digest(plain));
}

// --- Portal sessions -------------------------------------------------------
// A compact HMAC-signed token: base64url(payload).base64url(sig). It only
// proves who signed in to the portal; Sigma never sees it.
//
// SESSION_SECRET is optional: without it the key is derived from EMBED_SECRET,
// so a fresh deploy needs one secret fewer. Rotating the embed secret then
// signs everyone out of the portal.
function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s) {
    if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return s;
  }
  const embed = process.env.EMBED_SECRET;
  if (!embed) throw new Error('EMBED_SECRET is not configured');
  return crypto.createHmac('sha256', embed).update('portal-session').digest('base64url');
}

// `notAfter` (ISO date) caps the session at a proof-of-value end date.
export function issueSession({ role, tenantId = null, userId = null, username, notAfter = null }) {
  const now = Math.floor(Date.now() / 1000);
  const cap = notAfter ? Math.floor(Date.parse(notAfter) / 1000) : Infinity;
  const payload = { role, tenantId, userId, username, iat: now, exp: Math.min(now + SESSION_TTL, cap) };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: payload.exp };
}

export function readSession(req) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  // Compare the encoded strings, not decoded bytes: base64url decoding ignores
  // the trailing padding bits, so several spellings decode to the same bytes.
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Constant-time string compare for usernames, so a miss and a hit cost the same.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
