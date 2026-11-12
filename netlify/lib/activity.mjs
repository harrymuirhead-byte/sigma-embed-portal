import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

// One blob per event, so concurrent writes never clobber each other. The key
// carries the fields the console filters on —
//   <sortable timestamp>~<type>~<tenantId>~<random>
// — so listing and filtering never has to open events it won't show.
const store = () => getStore({ name: 'embed-portal-activity', consistency: 'strong' });
const RETENTION_DAYS = 90;

const stamp = (d) => d.toISOString().replace(/[:.]/g, '-');
const parseKey = (key) => {
  const [ts, type, tenantId] = key.split('~');
  return { key, ts, type, tenantId: tenantId === '-' ? null : tenantId };
};

// Never throws: losing an audit line must not break a sign-in.
export async function logEvent(req, context, event) {
  try {
    const now = new Date();
    const key = [stamp(now), event.type, event.tenantId || '-', crypto.randomBytes(4).toString('hex')].join('~');
    await store().setJSON(key, {
      ts: now.toISOString(),
      ip: (context && context.ip) || null,
      userAgent: (req.headers.get('user-agent') || '').slice(0, 200),
      ...event,
    });
  } catch (err) {
    console.error('activity log write failed', err);
  }
}

// Newest first. `types` is a list of type prefixes (e.g. "signin", "admin.").
export async function listEvents({ limit = 100, before = null, tenantId = null, types = null } = {}) {
  const s = store();
  const { blobs } = await s.list();
  const cutoff = stamp(new Date(Date.now() - RETENTION_DAYS * 86400e3));

  // Opportunistic retention: drop a bounded batch of expired events per read.
  const expired = blobs.filter((b) => b.key < cutoff).slice(0, 50);
  await Promise.all(expired.map((b) => s.delete(b.key).catch(() => {})));

  const matches = blobs
    .map((b) => parseKey(b.key))
    .filter((k) => k.ts >= cutoff)
    .filter((k) => !before || k.key < before)
    .filter((k) => !tenantId || k.tenantId === tenantId)
    .filter((k) => !types || types.some((t) => k.type.startsWith(t)))
    .sort((a, b) => (a.key < b.key ? 1 : -1));

  const page = matches.slice(0, limit);
  const events = await Promise.all(page.map(async (k) => ({ id: k.key, ...((await s.get(k.key, { type: 'json' })) || {}) })));
  return { events, next: matches.length > limit ? page[page.length - 1].key : null, total: matches.length };
}

// Who did it, in the shape every event carries.
export const actorOf = (session) => (session ? { role: session.role, username: session.username } : null);
