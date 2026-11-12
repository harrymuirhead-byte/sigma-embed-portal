import crypto from 'node:crypto';

// Access levels map onto Sigma account types. A JWT with a different
// account_type updates the embed user on their next sign-in, which is how an
// admin change reaches a company without touching Sigma directly.
// Viewer, Explorer and Creator are Sigma's default account types; use Custom
// for any other account type defined in the org.
export const ACCESS_LEVELS = {
  view:    { label: 'View only', accountType: 'Viewer' },
  explore: { label: 'Explore',   accountType: 'Explorer' },
  build:   { label: 'Build',     accountType: 'Creator' },
  custom:  { label: 'Custom',    accountType: null },
};

// Interface flags. Each maps to a documented embed URL parameter that only
// accepts `true`, so a false flag is simply left off the URL.
export const UI_FLAGS = {
  showAssistant:           ':show_assistant',
  hideFolderNavigation:    ':hide_folder_navigation',
  hideSaveAs:              ':hide_save_as',
  hideExploreToggle:       ':hide_explore_toggle',
  hideSend:                ':hide_send',
  hideSchedule:            ':hide_schedule',
  hideBookmarks:           ':hide_bookmarks',
  hideElementInteractions: ':hide_element_interactions',
  hideTooltip:             ':hide_tooltip',
};

export const DEFAULT_PERMISSIONS = {
  accessLevel: 'view',
  customAccountType: '',
  menuPosition: 'bottom',
  theme: '',
  lng: '',
  sessionLength: 3600,
  showAssistant: false,
  hideFolderNavigation: true,
  hideSaveAs: false,
  hideExploreToggle: false,
  hideSend: false,
  hideSchedule: false,
  hideBookmarks: false,
  hideElementInteractions: false,
  hideTooltip: false,
};

const MENU_POSITIONS = ['none', 'top', 'bottom'];
const NAME_RE = /^[A-Za-z0-9 _.-]{1,64}$/;

export function normalizePermissions(input = {}, base = DEFAULT_PERMISSIONS) {
  const p = { ...DEFAULT_PERMISSIONS, ...base };
  if (input.accessLevel in ACCESS_LEVELS) p.accessLevel = input.accessLevel;
  if (typeof input.customAccountType === 'string') p.customAccountType = input.customAccountType.trim().slice(0, 64);
  if (MENU_POSITIONS.includes(input.menuPosition)) p.menuPosition = input.menuPosition;
  if (typeof input.theme === 'string') p.theme = input.theme.trim().slice(0, 64);
  if (typeof input.lng === 'string') p.lng = input.lng.trim().slice(0, 16);
  if (input.sessionLength !== undefined) {
    const n = parseInt(input.sessionLength, 10);
    if (Number.isFinite(n)) p.sessionLength = Math.min(Math.max(n, 300), 86400);
  }
  for (const key of Object.keys(UI_FLAGS)) {
    if (typeof input[key] === 'boolean') p[key] = input[key];
  }

  if (p.accessLevel === 'custom' && !NAME_RE.test(p.customAccountType)) {
    throw new Error('Custom access needs a Sigma account type name');
  }
  if (p.theme && !NAME_RE.test(p.theme)) throw new Error('Theme name contains unsupported characters');
  if (p.lng && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(p.lng)) throw new Error('Language must be a code such as en or fr-CA');
  return p;
}

export function accountTypeFor(permissions) {
  return permissions.accessLevel === 'custom'
    ? permissions.customAccountType
    : ACCESS_LEVELS[permissions.accessLevel].accountType;
}

// Any host, org or path is accepted (production, staging, regional, custom
// domains). The only rule is http(s), since the URL becomes an iframe src.
// An embed still only renders in the org that issued CLIENT_ID.
//
// Returns { base, nodeId, pathMode }. For a recognisable Sigma workbook/report
// link, base keeps any /tag/ or /edit segment and nodeId is the page or element
// it pointed at (from /page/, /element/ or :nodeId). Any other URL is used as
// entered, minus Sigma's own :params, which are rebuilt at signing time.
export function parseSigmaUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) throw new Error('Enter a URL');
  // A link pasted without its scheme (staging.sigmacomputing.io/…) gets https://.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^(javascript|data|vbscript|blob|file|about):/i.test(text)) {
    text = `https://${text.replace(/^\/+/, '')}`;
  }
  let u;
  try { u = new URL(text); } catch { throw new Error('That URL could not be read'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL must start with https://');

  const param = u.search.match(/[?&]:nodeId=([^&]+)/);
  const fromParam = param ? decodeURIComponent(param[1]) : null;
  const clean = (id) => (id && NODE_RE.test(id) ? id : null);

  const m = u.pathname.replace(/\/+$/, '').match(/^(\/[^/]+\/(?:workbook|report)\/[^/]+(?:\/tag\/[^/]+)?(?:\/edit)?)(?:\/(page|element)\/([^/]+))?$/);
  if (m) return { base: `${u.origin}${m[1]}`, nodeId: clean(m[3] || fromParam), pathMode: m[2] || null };

  // Keep the URL's own query (minus :jwt, :embed, :nodeId …) so nothing the
  // user pasted is lost.
  const rest = u.search.replace(/^\?/, '').split('&').filter((p) => p && !p.startsWith(':'));
  const path = u.pathname.replace(/\/+$/, '');
  return { base: `${u.origin}${path}${rest.length ? `?${rest.join('&')}` : ''}`, nodeId: clean(fromParam), pathMode: null };
}

const NODE_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const APP_MODES = ['workbook', 'page', 'element'];

// The URL Sigma is asked to render for one app: the whole workbook (opening
// on nodeId when set), a single page, or a single element.
export function appEmbedBase(app) {
  if (app.mode === 'page' && app.nodeId) return `${app.base}/page/${app.nodeId}`;
  if (app.mode === 'element' && app.nodeId) return `${app.base}/element/${app.nodeId}`;
  return app.nodeId ? `${app.base}${app.base.includes('?') ? '&' : '?'}:nodeId=${app.nodeId}` : app.base;
}

// `identity` is the resolved user: who Sigma signs in, with which account type
// and attributes. Interface flags and teams come from the company; `app` picks
// what to render.
export function buildEmbedUrl(tenant, identity, app) {
  const clientId = process.env.CLIENT_ID;
  const secret = process.env.EMBED_SECRET;
  if (!clientId || !secret) throw new Error('Embed credentials are not configured');

  const p = normalizePermissions(tenant.permissions);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: identity.embedEmail,
    iss: clientId,
    jti: crypto.randomUUID(),
    iat: now,
    // Never outlive a proof-of-value end date.
    exp: identity.notAfter ? Math.min(now + p.sessionLength, identity.notAfter) : now + p.sessionLength,
    ver: '1.1',
    aud: 'sigmacomputing',
    account_type: identity.accountType,
    teams: tenant.teams || [],
    first_name: identity.firstName,
  };
  if (identity.lastName) payload.last_name = identity.lastName;
  if (identity.userAttributes && Object.keys(identity.userAttributes).length) {
    payload.user_attributes = identity.userAttributes;
  }

  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT', kid: clientId });
  const body = enc(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');

  // Built by hand rather than with URLSearchParams, which would percent-encode
  // the leading colon in Sigma's parameter names.
  const [base, existing] = appEmbedBase(app).split('?');
  const qs = existing ? [existing] : [];
  qs.push(`:jwt=${head}.${body}.${sig}`, ':embed=true', `:menu_position=${p.menuPosition}`);
  for (const [key, param] of Object.entries(UI_FLAGS)) {
    if (p[key]) qs.push(`${param}=true`);
  }
  if (p.theme) qs.push(`:theme=${encodeURIComponent(p.theme)}`);
  if (p.lng) qs.push(`:lng=${encodeURIComponent(p.lng)}`);

  return { url: `${base}?${qs.join('&')}`, expiresIn: payload.exp - now, accountType: payload.account_type };
}
