import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { hashPassword } from './auth.mjs';
import { ACCESS_LEVELS, APP_MODES, DEFAULT_PERMISSIONS, accountTypeFor, normalizePermissions, parseSigmaUrl } from './sigma.mjs';

// Strong consistency so a permission change made in the admin console is what
// the very next sign-in reads, not a stale edge copy.
const store = () => getStore({ name: 'embed-portal', consistency: 'strong' });
const KEY = 'tenants';

export async function loadTenants() {
  const tenants = (await store().get(KEY, { type: 'json' })) || {};
  const before = JSON.stringify(tenants);
  Object.values(tenants).forEach(migrate);
  // Persist an upgrade straight away so ids minted during migration are the
  // ones every later request sees.
  if (JSON.stringify(tenants) !== before) await saveTenants(tenants);
  return tenants;
}

export async function saveTenants(tenants) {
  await store().setJSON(KEY, tenants);
}

const newId = (prefix) => prefix + crypto.randomBytes(6).toString('hex');

// Older records are upgraded in memory and written back in the new shape on
// the next save, so nothing ever has to be re-entered:
//  - a single login on the company becomes its first user;
//  - a single workbook URL becomes its first app.
function migrate(t) {
  if (!Array.isArray(t.users)) {
    t.users = [];
    if (t.username && t.passwordHash) {
      t.users.push({
        id: `u_${t.id}`,
        username: t.username,
        passwordHash: t.passwordHash,
        firstName: t.name,
        lastName: 'User',
        embedEmail: t.embedEmail,
        accessLevel: 'inherit',
        customAccountType: '',
        userAttributes: {},
        enabled: true,
        updatedAt: t.updatedAt,
        updatedBy: t.updatedBy,
      });
    }
  }
  delete t.username;
  delete t.passwordHash;
  delete t.embedEmail;

  if (!Array.isArray(t.apps)) {
    t.apps = [];
    if (t.workbookUrl) {
      try {
        const { base, nodeId } = parseSigmaUrl(t.workbookUrl);
        t.apps.push({ id: `a_${t.id}`, name: 'Overview', description: '', icon: 'dashboard', base, mode: 'workbook', nodeId });
      } catch { /* an unparseable legacy URL is dropped; the admin re-adds it */ }
    }
  }
  delete t.workbookUrl;

  t.accessEndsAt = t.accessEndsAt || null;
  for (const u of t.users) {
    u.accessEndsAt = u.accessEndsAt || null;
    u.links = Array.isArray(u.links) ? u.links : [];
  }
  return t;
}

const allUsers = (tenants) => Object.values(tenants).flatMap((t) => t.users.map((u) => ({ tenant: t, user: u })));

export function findLogin(tenants, username) {
  const u = String(username || '').trim().toLowerCase();
  return allUsers(tenants).find((x) => x.user.username === u) || null;
}

// Older sessions carry only a username; newer ones carry the user id too.
export function resolveUser(tenant, session) {
  if (!tenant) return null;
  return tenant.users.find((u) => u.id === session.userId)
    || tenant.users.find((u) => u.username === session.username)
    || null;
}

// ---------- Access windows ----------
// A company and each user can carry an end date. No date means no end, which
// is how every account created before this feature behaves.
const endsAt = (tenant, user) => {
  const dates = [tenant.accessEndsAt, user && user.accessEndsAt].filter(Boolean).map((d) => Date.parse(d));
  return dates.length ? new Date(Math.min(...dates)).toISOString() : null;
};

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Whether a company user may use the portal right now, and if not, why.
export function accessState(tenant, user, now = Date.now()) {
  const end = endsAt(tenant, user);
  if (!tenant.enabled || !user.enabled) {
    return { ok: false, reason: 'paused', endsAt: end, message: 'Access for this account is paused. Contact your administrator.' };
  }
  if (end && Date.parse(end) <= now) {
    return { ok: false, reason: 'expired', endsAt: end, message: `Access for this account ended on ${fmtDate(end)}.` };
  }
  return { ok: true, reason: null, endsAt: end, message: null };
}

// ---------- Sign-in links ----------
// Only a SHA-256 of the token is stored. The token itself is shown to the
// admin once, at creation, as part of the link.
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('base64url');

function linkStatus(link, now = Date.now()) {
  if (link.revokedAt) return 'revoked';
  if (link.singleUse && link.usedAt) return 'used';
  if (Date.parse(link.expiresAt) <= now) return 'expired';
  return 'active';
}

export function createLink(tenant, user, { expiresIn, singleUse }, actor) {
  const now = Date.now();
  const accessEnd = endsAt(tenant, user);
  let expiresAt = expiresIn === 'access-end'
    ? accessEnd
    : new Date(now + Math.min(Math.max(parseInt(expiresIn, 10) || 0, 300), 90 * 86400) * 1000).toISOString();
  if (!expiresAt) throw new Error('This user has no access end date to tie the link to');
  if (accessEnd && Date.parse(expiresAt) > Date.parse(accessEnd)) expiresAt = accessEnd;
  if (Date.parse(expiresAt) <= now) throw new Error('This user’s access has already ended');

  // Keep the list short: drop links that stopped working over a week ago.
  user.links = user.links.filter((l) => linkStatus(l, now) === 'active' || now - Date.parse(l.revokedAt || l.usedAt || l.expiresAt) < 7 * 86400e3);

  const token = crypto.randomBytes(32).toString('base64url');
  const link = {
    id: newId('l_'),
    tokenHash: hashToken(token),
    createdAt: new Date(now).toISOString(),
    createdBy: actor,
    expiresAt,
    singleUse: !!singleUse,
    usedAt: null,
    uses: 0,
    revokedAt: null,
  };
  user.links.push(link);
  return { link, token };
}

// Finds the user a link token belongs to and checks the link is still usable.
// On success the use is recorded on the link (the caller saves).
export function redeemLink(tenants, token) {
  const hash = hashToken(token);
  for (const { tenant, user } of allUsers(tenants)) {
    const link = user.links.find((l) => l.tokenHash === hash);
    if (!link) continue;
    const status = linkStatus(link);
    if (status !== 'active') return { tenant, user, link, error: status };
    link.uses += 1;
    link.usedAt = new Date().toISOString();
    return { tenant, user, link, error: null };
  }
  return null;
}

// ---------- Validation ----------
const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Sigma rejects embed emails with whitespace or underscores (JWT `sub` rules).
const EMAIL_RE = /^[^\s_@]+@[^\s_@]+\.[^\s_@]+$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9.@-]{1,63}$/;
const NAME_RE = /^[A-Za-z0-9 _.-]{1,64}$/;
const USER_LEVELS = ['inherit', ...Object.keys(ACCESS_LEVELS)];
export const APP_ICONS = ['dashboard', 'chart', 'trend', 'table', 'map', 'ai', 'report', 'people', 'money', 'box'];

function cleanTeams(teams) {
  const list = Array.isArray(teams) ? teams : String(teams || '').split(',');
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
}

function cleanAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    const key = String(k).trim();
    if (key) out[key.slice(0, 64)] = String(v ?? '').slice(0, 256);
  }
  return out;
}

function cleanDate(value, label) {
  if (value === null || value === '') return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new Error(`${label} is not a valid date`);
  return new Date(t).toISOString();
}

// Apps arrive as a full ordered list from the console. Existing ids are kept
// so links and activity history stay attached to the same app.
function cleanApps(input, existing = []) {
  if (!Array.isArray(input)) throw new Error('Apps must be a list');
  if (input.length > 24) throw new Error('A company can have at most 24 apps');
  return input.map((a, i) => {
    const name = String(a.name || '').trim().slice(0, 48);
    if (!name) throw new Error(`App ${i + 1} needs a name`);
    let parsed;
    try { parsed = parseSigmaUrl(a.url); } catch (err) { throw new Error(`${name}: ${err.message}`); }
    const mode = APP_MODES.includes(a.mode) ? a.mode : (parsed.pathMode || 'workbook');
    if (mode !== 'workbook' && !parsed.nodeId) {
      throw new Error(`${name}: a single ${mode} needs a link that includes the ${mode} id — select it in Sigma and copy the URL`);
    }
    const keep = existing.find((x) => x.id === a.id);
    return {
      id: keep ? keep.id : newId('a_'),
      name,
      description: String(a.description || '').trim().slice(0, 120),
      icon: APP_ICONS.includes(a.icon) ? a.icon : 'dashboard',
      base: parsed.base,
      mode,
      nodeId: parsed.nodeId,
    };
  });
}

// Applies an admin edit on top of an existing company (or a blank one) and
// validates the result. Throws with a user-facing message on bad input.
export function applyTenantChanges(tenants, existing, input, actor) {
  const t = existing
    ? structuredClone(existing)
    : { id: null, enabled: true, permissions: { ...DEFAULT_PERMISSIONS }, teams: [], userAttributes: {}, users: [], apps: [], accessEndsAt: null };

  if (input.name !== undefined) t.name = String(input.name).trim().slice(0, 64);
  if (!t.name) throw new Error('Company name is required');
  if (!t.id) {
    t.id = slug(t.name);
    if (!t.id) throw new Error('Company name needs at least one letter or number');
    if (tenants[t.id]) throw new Error(`A company with the id "${t.id}" already exists`);
  }

  // Only organises the admin console's company list; users never see it.
  if (input.group !== undefined) t.group = String(input.group || '').trim().replace(/\s+/g, ' ').slice(0, 40);

  if (input.apps !== undefined) t.apps = cleanApps(input.apps, t.apps);
  if (!t.apps.length) throw new Error('Add at least one app (a Sigma workbook, page or element)');

  if (input.teams !== undefined) t.teams = cleanTeams(input.teams);
  if (!t.teams.length) throw new Error('At least one Sigma team is required — the embed has no access without one');

  if (input.userAttributes !== undefined) t.userAttributes = cleanAttributes(input.userAttributes);
  if (typeof input.enabled === 'boolean') t.enabled = input.enabled;
  if (input.accessEndsAt !== undefined) t.accessEndsAt = cleanDate(input.accessEndsAt, 'Access end date');
  if (input.permissions !== undefined) t.permissions = normalizePermissions(input.permissions, t.permissions);

  t.updatedAt = new Date().toISOString();
  t.updatedBy = actor;
  return t;
}

// Same idea for one user inside a company. Usernames and embed emails are
// unique across the whole portal: Sigma keys embed users by email, so two
// portal users sharing one would overwrite each other's account type.
export function applyUserChanges(tenants, tenant, existing, input, actor) {
  const u = existing
    ? structuredClone(existing)
    : { id: newId('u_'), accessLevel: 'inherit', customAccountType: '', userAttributes: {}, enabled: true, accessEndsAt: null, links: [] };

  if (input.firstName !== undefined) u.firstName = String(input.firstName).trim().slice(0, 64);
  if (input.lastName !== undefined) u.lastName = String(input.lastName).trim().slice(0, 64);
  if (!u.firstName) throw new Error('First name is required');

  if (input.username !== undefined) u.username = String(input.username).trim().toLowerCase();
  if (!USERNAME_RE.test(u.username || '')) throw new Error('Username must be 2–64 lowercase letters, numbers, dots, hyphens or @');
  const adminName = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const login = findLogin(tenants, u.username);
  if (u.username === adminName || (login && login.user.id !== u.id)) throw new Error(`Username "${u.username}" is already taken`);

  // Link-only users have no password at all, so password sign-in can't work
  // for them even by accident.
  if (input.passwordLogin === false) {
    delete u.passwordHash;
  } else if (input.password) {
    if (String(input.password).length < 8) throw new Error('Password must be at least 8 characters');
    u.passwordHash = hashPassword(input.password);
  }
  if (!u.passwordHash && input.passwordLogin !== false) throw new Error('A password is required, or switch this user to sign-in links only');

  if (input.embedEmail !== undefined) u.embedEmail = String(input.embedEmail).trim().toLowerCase();
  if (!EMAIL_RE.test(u.embedEmail || '')) throw new Error('Embed user email must be a valid address with no underscores');
  const emailClash = allUsers(tenants).find((x) => x.user.embedEmail === u.embedEmail && x.user.id !== u.id);
  if (emailClash) throw new Error(`${u.embedEmail} is already used by ${emailClash.user.username} (${emailClash.tenant.name})`);

  if (USER_LEVELS.includes(input.accessLevel)) u.accessLevel = input.accessLevel;
  if (typeof input.customAccountType === 'string') u.customAccountType = input.customAccountType.trim().slice(0, 64);
  if (u.accessLevel === 'custom' && !NAME_RE.test(u.customAccountType)) throw new Error('Custom access needs a Sigma account type name');

  if (input.userAttributes !== undefined) u.userAttributes = cleanAttributes(input.userAttributes);
  if (typeof input.enabled === 'boolean') u.enabled = input.enabled;
  if (input.accessEndsAt !== undefined) u.accessEndsAt = cleanDate(input.accessEndsAt, 'Access end date');

  u.updatedAt = new Date().toISOString();
  u.updatedBy = actor;
  return u;
}

// ---------- Resolving what gets signed ----------
// The account type a user is actually signed in with: their own level, or the
// company default when they inherit it.
export function effectiveAccess(tenant, user) {
  const p = normalizePermissions(tenant.permissions);
  const inherited = !user || user.accessLevel === 'inherit';
  const source = inherited ? p : user;
  return {
    level: source.accessLevel,
    label: ACCESS_LEVELS[source.accessLevel].label,
    accountType: accountTypeFor(source),
    inherited,
  };
}

// Company attributes apply to everyone; a user's own value wins on a clash.
export function effectiveAttributes(tenant, user) {
  return { ...(tenant.userAttributes || {}), ...((user && user.userAttributes) || {}) };
}

export function identityFor(tenant, user) {
  const end = endsAt(tenant, user);
  return {
    embedEmail: user.embedEmail,
    firstName: user.firstName,
    lastName: user.lastName,
    accountType: effectiveAccess(tenant, user).accountType,
    userAttributes: effectiveAttributes(tenant, user),
    notAfter: end ? Math.floor(Date.parse(end) / 1000) : null,
  };
}

export function findApp(tenant, appId) {
  return tenant.apps.find((a) => a.id === appId) || tenant.apps[0] || null;
}

// ---------- Change tracking ----------
// A flat list of what an admin edit changed, for the activity log. Secrets
// are reduced to "changed" and bookkeeping fields are skipped.
const SKIP = new Set(['updatedAt', 'updatedBy', 'users', 'links', 'id']);
export function diffRecords(before, after) {
  const changes = [];
  const walk = (a, b, path) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      if (SKIP.has(k)) continue;
      const field = path ? `${path}.${k}` : k;
      const x = a ? a[k] : undefined;
      const y = b ? b[k] : undefined;
      if (k === 'passwordHash') {
        if (x !== y) changes.push({ field: 'password', from: x ? 'set' : 'none', to: y ? 'reset' : 'removed' });
        continue;
      }
      if (k === 'permissions' && x && y) { walk(x, y, field); continue; }
      if (k === 'apps') { diffApps(x || [], y || [], changes); continue; }
      if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) changes.push({ field, from: x ?? null, to: y ?? null });
    }
  };
  walk(before, after, '');
  return changes;
}

// Apps are matched by id, so an edit reads as "Forecasts.description" rather
// than the whole list before and after.
function diffApps(before, after, changes) {
  for (const a of after) {
    const old = before.find((b) => b.id === a.id);
    if (!old) { changes.push({ field: `apps.${a.name}`, from: null, to: 'added' }); continue; }
    for (const f of ['name', 'description', 'icon', 'mode', 'base', 'nodeId']) {
      if ((old[f] ?? null) !== (a[f] ?? null)) changes.push({ field: `apps.${old.name}.${f}`, from: old[f] ?? null, to: a[f] ?? null });
    }
  }
  for (const b of before) {
    if (!after.some((a) => a.id === b.id)) changes.push({ field: `apps.${b.name}`, from: 'present', to: 'removed' });
  }
  const order = (list) => list.map((a) => a.id).filter((id) => before.some((b) => b.id === id) && after.some((a) => a.id === id));
  if (order(before).join() !== order(after).join()) {
    changes.push({ field: 'apps.order', from: before.map((a) => a.name).join(', '), to: after.map((a) => a.name).join(', ') });
  }
}

// ---------- What leaves the server: never a password or token hash ----------
export function publicUser(tenant, user) {
  const { passwordHash, links, ...rest } = user;
  const state = accessState(tenant, user);
  return {
    ...rest,
    passwordLogin: !!passwordHash,
    access: effectiveAccess(tenant, user),
    state: { ok: state.ok, reason: state.reason, endsAt: state.endsAt },
    links: (links || []).map(({ tokenHash, ...l }) => ({ ...l, status: linkStatus(l) })),
  };
}

export function publicTenant(t) {
  const p = normalizePermissions(t.permissions);
  const ended = t.accessEndsAt && Date.parse(t.accessEndsAt) <= Date.now();
  return {
    ...t,
    permissions: p,
    accessLabel: ACCESS_LEVELS[p.accessLevel].label,
    accountType: accountTypeFor(p),
    expired: !!ended,
    apps: t.apps.map((a) => ({ ...a, url: appUrlForEditing(a) })),
    users: t.users.map((u) => publicUser(t, u)),
  };
}

// The link shown back in the console's URL field for an app.
function appUrlForEditing(a) {
  if (!a.nodeId) return a.base;
  if (a.mode === 'page') return `${a.base}/page/${a.nodeId}`;
  if (a.mode === 'element') return `${a.base}/element/${a.nodeId}`;
  return `${a.base}?:nodeId=${a.nodeId}`;
}
