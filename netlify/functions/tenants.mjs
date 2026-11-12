import { json, readSession } from '../lib/auth.mjs';
import { actorOf, logEvent } from '../lib/activity.mjs';
import {
  applyTenantChanges, applyUserChanges, createLink, diffRecords, loadTenants, publicTenant, publicUser, saveTenants,
} from '../lib/tenants.mjs';

// Admin-only CRUD for companies, their apps and embed permissions, their
// users, and users' sign-in links. Every change lands in the activity log.
export default async (req, context) => {
  const session = readSession(req);
  if (!session) return json(401, { error: 'Not signed in' });
  if (session.role !== 'admin') return json(403, { error: 'Admin access required' });

  const { id, userId, linkId } = context.params || {};
  const path = new URL(req.url).pathname;
  const tenants = await loadTenants();
  const actor = actorOf(session);
  const log = (type, extra) => logEvent(req, context, { type, actor, ...extra });

  const readBody = async () => {
    try { return await req.json(); } catch { return null; }
  };

  // ---------- /api/tenants/:id/users/:userId/links[/:linkId] ----------
  if (path.includes('/links')) {
    const tenant = tenants[id];
    const user = tenant && tenant.users.find((u) => u.id === userId);
    if (!user) return json(404, { error: 'User not found' });
    const who = { tenantId: tenant.id, tenantName: tenant.name, userId: user.id, username: user.username };

    if (req.method === 'POST' && !linkId) {
      const body = (await readBody()) || {};
      try {
        const { link, token } = createLink(tenant, user, body, session.username);
        await saveTenants(tenants);
        await log('admin.link.created', { ...who, linkId: link.id, details: { expiresAt: link.expiresAt, singleUse: link.singleUse } });
        // The raw token is returned exactly once; only its hash is stored.
        return json(201, { token, linkId: link.id, user: publicUser(tenant, user), tenant: publicTenant(tenant) });
      } catch (err) {
        return json(400, { error: err.message });
      }
    }
    if (req.method === 'DELETE' && linkId) {
      const link = user.links.find((l) => l.id === linkId);
      if (!link) return json(404, { error: 'Link not found' });
      link.revokedAt = link.revokedAt || new Date().toISOString();
      await saveTenants(tenants);
      await log('admin.link.revoked', { ...who, linkId });
      return json(200, { user: publicUser(tenant, user), tenant: publicTenant(tenant) });
    }
    return json(405, { error: 'Method not allowed' });
  }

  // ---------- /api/tenants/:id/users[/:userId] ----------
  if (path.includes('/users')) {
    const tenant = tenants[id];
    if (!tenant) return json(404, { error: 'Company not found' });
    const idx = userId ? tenant.users.findIndex((u) => u.id === userId) : -1;
    if (userId && idx < 0) return json(404, { error: 'User not found' });
    const where = { tenantId: tenant.id, tenantName: tenant.name };

    if (req.method === 'DELETE' && userId) {
      const [gone] = tenant.users.splice(idx, 1);
      await saveTenants(tenants);
      await log('admin.user.deleted', { ...where, userId: gone.id, username: gone.username });
      return json(200, { deleted: userId, tenant: publicTenant(tenant) });
    }
    if ((req.method === 'POST' && !userId) || (req.method === 'PUT' && userId)) {
      const body = await readBody();
      if (!body) return json(400, { error: 'Invalid request' });
      try {
        const before = userId ? tenant.users[idx] : null;
        const u = applyUserChanges(tenants, tenant, before, body, session.username);
        if (userId) tenant.users[idx] = u; else tenant.users.push(u);
        await saveTenants(tenants);
        await log(userId ? 'admin.user.updated' : 'admin.user.created', {
          ...where, userId: u.id, username: u.username, changes: diffRecords(before, u),
        });
        return json(userId ? 200 : 201, { user: publicUser(tenant, u), tenant: publicTenant(tenant) });
      } catch (err) {
        return json(400, { error: err.message });
      }
    }
    return json(405, { error: 'Method not allowed' });
  }

  // ---------- /api/tenants[/:id] ----------
  if (req.method === 'GET') {
    if (id) return tenants[id] ? json(200, publicTenant(tenants[id])) : json(404, { error: 'Not found' });
    const list = Object.values(tenants).sort((a, b) => a.name.localeCompare(b.name)).map(publicTenant);
    return json(200, { tenants: list });
  }

  if (req.method === 'DELETE') {
    if (!id || !tenants[id]) return json(404, { error: 'Not found' });
    const gone = tenants[id];
    delete tenants[id];
    await saveTenants(tenants);
    await log('admin.company.deleted', { tenantId: gone.id, tenantName: gone.name, details: { users: gone.users.length } });
    return json(200, { deleted: id });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const body = await readBody();
    if (!body) return json(400, { error: 'Invalid request' });
    const existing = req.method === 'PUT' ? tenants[id] : null;
    if (req.method === 'PUT' && !existing) return json(404, { error: 'Not found' });

    try {
      const t = applyTenantChanges(tenants, existing, body, session.username);
      tenants[t.id] = t;
      await saveTenants(tenants);
      await log(existing ? 'admin.company.updated' : 'admin.company.created', {
        tenantId: t.id, tenantName: t.name, changes: diffRecords(existing, t),
      });
      return json(req.method === 'POST' ? 201 : 200, publicTenant(t));
    } catch (err) {
      return json(400, { error: err.message });
    }
  }

  return json(405, { error: 'Method not allowed' });
};

export const config = {
  path: [
    '/api/tenants', '/api/tenants/:id',
    '/api/tenants/:id/users', '/api/tenants/:id/users/:userId',
    '/api/tenants/:id/users/:userId/links', '/api/tenants/:id/users/:userId/links/:linkId',
  ],
};
