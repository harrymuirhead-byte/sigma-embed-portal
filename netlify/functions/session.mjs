import { json, readSession } from '../lib/auth.mjs';
import { accessState, effectiveAccess, loadTenants, resolveUser } from '../lib/tenants.mjs';

// Lets a page confirm its stored token is still good before rendering, and
// tells a company user which embed (and access level) they have right now.
export default async (req) => {
  const session = readSession(req);
  if (!session) return json(401, { error: 'Not signed in' });
  if (session.role === 'admin') return json(200, { role: 'admin', username: session.username });

  const tenant = (await loadTenants())[session.tenantId];
  const user = resolveUser(tenant, session);
  if (!tenant || !user) return json(403, { error: 'Your account no longer exists' });
  const state = accessState(tenant, user);
  if (!state.ok) return json(403, { error: state.message });
  return json(200, {
    role: 'tenant',
    username: user.username,
    user: { firstName: user.firstName, lastName: user.lastName },
    tenant: { id: tenant.id, name: tenant.name, accessLabel: effectiveAccess(tenant, user).label, accessEndsAt: state.endsAt },
  });
};

export const config = { path: '/api/session' };
