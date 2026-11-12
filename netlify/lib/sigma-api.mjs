// Read-only Sigma REST API client for the admin console's pick lists.
//
// Deliberately narrow: four fixed GET calls, no generic pass-through, so the
// portal can't be used to call anything else in Sigma even by mistake. The
// credential's owner is a View-only service user, which is the real limit on
// what it can do; this file just never asks for more.
const BASE = () => process.env.SIGMA_API_BASE || 'https://api.sigmacomputing.com';

export const apiConfigured = () => !!(process.env.SIGMA_API_CLIENT_ID && process.env.SIGMA_API_CLIENT_SECRET);

// The access token lasts an hour. It's cached in function memory only —
// never stored — and refreshed a minute early.
let cached = { token: null, until: 0 };
async function token() {
  if (cached.token && Date.now() < cached.until) return cached.token;
  const res = await fetch(`${BASE()}/v2/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SIGMA_API_CLIENT_ID,
      client_secret: process.env.SIGMA_API_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Sigma API sign-in failed (${res.status})`);
  const data = await res.json();
  cached = { token: data.access_token, until: Date.now() + ((data.expires_in || 3600) - 60) * 1000 };
  return cached.token;
}

async function get(path) {
  const res = await fetch(`${BASE()}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (res.status === 401) cached = { token: null, until: 0 };
  if (!res.ok) throw new Error(`Sigma API request failed (${res.status})`);
  return res.json();
}

// Follows Sigma's cursor pagination, with a hard cap so a huge org can't
// stall the function.
async function all(path, cap = 5000) {
  const out = [];
  let page = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const data = await get(`${path}${sep}limit=500${page ? `&page=${encodeURIComponent(page)}` : ''}`);
    out.push(...(data.entries || []));
    page = data.nextPage || null;
  } while (page && out.length < cap);
  return out;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const checkId = (id) => { if (!ID_RE.test(String(id))) throw new Error('Invalid id'); return id; };

export async function listWorkbooks() {
  return (await all('/v2/workbooks')).map((w) => ({
    workbookId: w.workbookId, name: w.name, path: w.path || '', url: w.url, updatedAt: w.updatedAt,
  }));
}

export async function listPages(workbookId) {
  return (await all(`/v2/workbooks/${checkId(workbookId)}/pages`)).map((p) => ({ pageId: p.pageId, name: p.name }));
}

export async function listElements(workbookId, pageId) {
  return (await all(`/v2/workbooks/${checkId(workbookId)}/pages/${checkId(pageId)}/elements`))
    .map((e) => ({ elementId: e.elementId, name: e.name || null, type: e.type || null }));
}

export async function listTeams() {
  return (await all('/v2/teams')).map((t) => t.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
}
