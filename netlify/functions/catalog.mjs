import { json, readSession } from '../lib/auth.mjs';
import { apiConfigured, listElements, listPages, listTeams, listWorkbooks } from '../lib/sigma-api.mjs';

// Admin-only pick lists sourced from the Sigma REST API: workbooks, their
// pages and elements, and the teams the service user can see.
//
// PICKER_FOLDERS (optional, comma-separated) narrows the workbook list to
// paths starting with those folders. It's a convenience filter for the
// console, not a security boundary — the credential itself decides access.
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export default async (req, context) => {
  const session = readSession(req);
  if (!session) return json(401, { error: 'Not signed in' });
  if (session.role !== 'admin') return json(403, { error: 'Admin access required' });
  if (!apiConfigured()) return json(501, { error: 'The Sigma API is not configured for this portal' });

  const { kind, workbookId, pageId } = context.params || {};
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  if (fresh) cache.clear();

  try {
    if (kind === 'teams') {
      return json(200, { teams: await cached('teams', 5 * 60e3, listTeams) });
    }
    if (kind === 'workbooks' && !workbookId) {
      const folders = (process.env.PICKER_FOLDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
      let workbooks = await cached('workbooks', 60e3, listWorkbooks);
      if (folders.length) workbooks = workbooks.filter((w) => folders.some((f) => w.path === f || w.path.startsWith(f + '/')));
      workbooks = [...workbooks].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return json(200, { workbooks, filtered: folders });
    }
    if (kind === 'workbooks' && workbookId && !pageId) {
      return json(200, { pages: await cached(`p:${workbookId}`, 60e3, () => listPages(workbookId)) });
    }
    if (kind === 'workbooks' && workbookId && pageId) {
      return json(200, { elements: await cached(`e:${workbookId}:${pageId}`, 60e3, () => listElements(workbookId, pageId)) });
    }
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error('catalog request failed', err);
    return json(502, { error: err.message === 'Invalid id' ? 'Invalid id' : 'Couldn’t reach the Sigma API' });
  }
};

export const config = {
  path: [
    '/api/catalog/:kind',
    '/api/catalog/:kind/:workbookId/pages',
    '/api/catalog/:kind/:workbookId/pages/:pageId/elements',
  ],
};
