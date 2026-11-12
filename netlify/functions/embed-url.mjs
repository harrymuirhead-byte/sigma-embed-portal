import { json, readSession } from '../lib/auth.mjs';
import { actorOf, logEvent } from '../lib/activity.mjs';
import { buildEmbedUrl } from '../lib/sigma.mjs';
import { accessState, effectiveAccess, findApp, identityFor, loadTenants, resolveUser } from '../lib/tenants.mjs';

// Signs a Sigma embed URL for one user and one app of one company. Settings
// are read fresh on every call, so the next sign-in (or the next token
// refresh) picks up whatever the admin last saved. The client only ever names
// ids — it can't supply a URL, account type or team.
export default async (req, context) => {
  const session = readSession(req);
  if (!session) return json(401, { error: 'Not signed in' });

  const params = new URL(req.url).searchParams;
  const requested = params.get('tenant');
  const isAdmin = session.role === 'admin';
  if (!isAdmin && requested && requested !== session.tenantId) {
    return json(403, { error: 'You do not have access to that embed' });
  }

  try {
    const tenant = (await loadTenants())[isAdmin ? requested : session.tenantId];
    if (!tenant) return json(404, { error: 'Embed not found' });

    // Admins preview as any user of the company (the first one by default);
    // a company user is always signed in as themselves.
    const user = isAdmin
      ? tenant.users.find((u) => u.id === params.get('user')) || tenant.users[0]
      : resolveUser(tenant, session);
    if (!user) {
      return json(isAdmin ? 400 : 403, { error: isAdmin ? 'Add a user to this company to open its embed' : 'Your account no longer exists' });
    }
    const state = accessState(tenant, user);
    if (!isAdmin && !state.ok) return json(403, { error: state.message });

    const app = findApp(tenant, params.get('app'));
    if (!app) return json(404, { error: 'This company has no apps yet' });

    const identity = identityFor(tenant, user);
    // An admin previewing an expired user still gets a working embed.
    if (isAdmin && !state.ok) identity.notAfter = null;
    const signed = buildEmbedUrl(tenant, identity, app);
    const access = effectiveAccess(tenant, user);

    // Token refreshes and developer-view signings aren't new visits.
    const purpose = params.get('purpose');
    if (purpose !== 'refresh' && purpose !== 'developer') {
      await logEvent(req, context, {
        type: 'embed.open',
        actor: actorOf(session),
        preview: isAdmin,
        tenantId: tenant.id, tenantName: tenant.name,
        userId: user.id, username: user.username,
        appId: app.id, appName: app.name,
        accountType: access.accountType,
      });
    }

    return json(200, {
      url: signed.url,
      expiresIn: signed.expiresIn,
      tenant: { id: tenant.id, name: tenant.name, enabled: tenant.enabled, accessLabel: access.label, accessLevel: access.level, accountType: access.accountType, accessEndsAt: state.endsAt },
      user: {
        id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName,
        embedEmail: user.embedEmail, enabled: user.enabled, inherited: access.inherited, state: state.reason,
      },
      app: { id: app.id, name: app.name, mode: app.mode },
      apps: tenant.apps.map((a) => ({ id: a.id, name: a.name, description: a.description, icon: a.icon, mode: a.mode })),
    });
  } catch (err) {
    console.error('embed signing failed', err);
    return json(500, { error: 'Failed to generate embed URL' });
  }
};

export const config = { path: '/api/embed-url' };
