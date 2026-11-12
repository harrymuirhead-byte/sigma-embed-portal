import { adminPasswordConfigured, issueSession, json, safeEqual, verifyAdminPassword, verifyPassword } from '../lib/auth.mjs';
import { logEvent } from '../lib/activity.mjs';
import { accessState, findLogin, loadTenants } from '../lib/tenants.mjs';

// Burn the same scrypt cost on unknown usernames so response time doesn't
// reveal which usernames exist.
const DUMMY_HASH = 'scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) return json(400, { error: 'Enter your username and password' });

  const fail = async (status, error, reason, extra = {}) => {
    await logEvent(req, context, { type: 'signin.failed', username, reason, method: 'password', ...extra });
    return json(status, { error });
  };

  try {
    const adminName = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    if (safeEqual(username, adminName)) {
      if (!adminPasswordConfigured()) return fail(503, 'Admin password is not configured. Set ADMIN_PASSWORD (12+ characters) in Netlify and redeploy.', 'admin_not_configured', { role: 'admin' });
      if (!verifyAdminPassword(password)) return fail(401, 'Incorrect username or password', 'bad_credentials', { role: 'admin' });
      const s = issueSession({ role: 'admin', username });
      await logEvent(req, context, { type: 'signin.success', username, role: 'admin', method: 'password' });
      return json(200, { ...s, role: 'admin', username, redirect: '/admin' });
    }

    const login = findLogin(await loadTenants(), username);
    const ok = verifyPassword(password, login && login.user.passwordHash ? login.user.passwordHash : DUMMY_HASH);
    if (!login || !login.user.passwordHash || !ok) {
      return fail(401, 'Incorrect username or password', 'bad_credentials', login ? { tenantId: login.tenant.id, tenantName: login.tenant.name } : {});
    }
    const { tenant, user } = login;
    const who = { tenantId: tenant.id, tenantName: tenant.name, userId: user.id };
    const state = accessState(tenant, user);
    if (!state.ok) return fail(403, state.message, state.reason, who);

    const s = issueSession({ role: 'tenant', tenantId: tenant.id, userId: user.id, username, notAfter: state.endsAt });
    await logEvent(req, context, { type: 'signin.success', username, role: 'tenant', method: 'password', ...who });
    return json(200, { ...s, role: 'tenant', username, tenant: { id: tenant.id, name: tenant.name }, redirect: '/portal' });
  } catch (err) {
    console.error('login failed', err);
    return json(500, { error: 'Sign-in is unavailable right now' });
  }
};

export const config = { path: '/api/login' };
