import { issueSession, json } from '../lib/auth.mjs';
import { logEvent } from '../lib/activity.mjs';
import { accessState, loadTenants, redeemLink, saveTenants } from '../lib/tenants.mjs';

const LINK_ERRORS = {
  expired: 'This sign-in link has expired. Ask your administrator for a new one.',
  used: 'This sign-in link has already been used. Ask your administrator for a new one.',
  revoked: 'This sign-in link has been withdrawn. Ask your administrator for a new one.',
};

// Exchanges a one-off sign-in link token for a normal portal session. The
// token travels in the request body (it sits in the link's #fragment, which
// browsers never send to the server or put in logs).
export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const token = String(body.token || '');
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return json(400, { error: 'This sign-in link is not valid' });

  try {
    const tenants = await loadTenants();
    const found = redeemLink(tenants, token);
    if (!found) {
      await logEvent(req, context, { type: 'signin.failed', method: 'link', reason: 'unknown_link' });
      return json(401, { error: 'This sign-in link is not valid' });
    }

    const { tenant, user, link, error } = found;
    const who = { username: user.username, tenantId: tenant.id, tenantName: tenant.name, userId: user.id, linkId: link.id };
    if (error) {
      await logEvent(req, context, { type: 'signin.failed', method: 'link', reason: `link_${error}`, ...who });
      return json(401, { error: LINK_ERRORS[error] });
    }
    const state = accessState(tenant, user);
    if (!state.ok) {
      await logEvent(req, context, { type: 'signin.failed', method: 'link', reason: state.reason, ...who });
      return json(403, { error: state.message });
    }

    await saveTenants(tenants); // records the use, which retires single-use links
    const notAfter = [state.endsAt, link.singleUse ? null : link.expiresAt].filter(Boolean).sort()[0] || null;
    const s = issueSession({ role: 'tenant', tenantId: tenant.id, userId: user.id, username: user.username, notAfter });
    await logEvent(req, context, { type: 'signin.success', role: 'tenant', method: 'link', ...who });
    return json(200, { ...s, role: 'tenant', username: user.username, tenant: { id: tenant.id, name: tenant.name }, redirect: '/portal' });
  } catch (err) {
    console.error('link login failed', err);
    return json(500, { error: 'Sign-in is unavailable right now' });
  }
};

export const config = { path: '/api/link-login' };
