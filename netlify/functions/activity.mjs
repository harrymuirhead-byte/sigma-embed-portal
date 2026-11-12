import { json, readSession } from '../lib/auth.mjs';
import { listEvents } from '../lib/activity.mjs';

const TYPE_FILTERS = {
  signins: ['signin.success'],
  failed: ['signin.failed'],
  embeds: ['embed.open'],
  admin: ['admin.'],
};

// Admin-only read of the activity log, newest first, paged by cursor.
export default async (req) => {
  const session = readSession(req);
  if (!session) return json(401, { error: 'Not signed in' });
  if (session.role !== 'admin') return json(403, { error: 'Admin access required' });

  const p = new URL(req.url).searchParams;
  try {
    const result = await listEvents({
      limit: Math.min(parseInt(p.get('limit'), 10) || 100, 500),
      before: p.get('before') || null,
      tenantId: p.get('tenant') || null,
      types: TYPE_FILTERS[p.get('type')] || null,
    });
    return json(200, result);
  } catch (err) {
    console.error('activity read failed', err);
    return json(500, { error: 'Could not load activity' });
  }
};

export const config = { path: '/api/activity' };
