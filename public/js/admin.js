(function () {
  const session = Portal.require('admin');
  if (!session) return;

  const $ = (id) => document.getElementById(id);

  // Mirrors the server's mapping so the preview reflects unsaved edits.
  const ACCOUNT_TYPES = { view: 'Viewer', explore: 'Explorer', build: 'Creator' };
  const LEVEL_LABELS = { view: 'View only', explore: 'Explore', build: 'Build', custom: 'Custom' };
  const BADGE_CLASS = { view: 'view', explore: 'explore', build: 'build', custom: 'custom' };
  const MODE_LABELS = { workbook: 'Whole workbook', page: 'Single page', element: 'Single element' };
  const SWITCHES = [
    ['showAssistant', 'Ask Sigma assistant', ':show_assistant'],
    ['hideFolderNavigation', 'Hide folder navigation', ':hide_folder_navigation'],
    ['hideSaveAs', 'Hide Save As', ':hide_save_as'],
    ['hideExploreToggle', 'Hide explore toggle', ':hide_explore_toggle'],
    ['hideSend', 'Hide download and export', ':hide_send'],
    ['hideSchedule', 'Hide scheduled exports', ':hide_schedule'],
    ['hideBookmarks', 'Hide saved views', ':hide_bookmarks'],
    ['hideElementInteractions', 'Hide element toolbar', ':hide_element_interactions'],
    ['hideTooltip', 'Hide chart tooltips', ':hide_tooltip'],
  ];
  const DEFAULTS = {
    accessLevel: 'view', customAccountType: '', menuPosition: 'bottom', theme: '', lng: '', sessionLength: 3600,
    showAssistant: false, hideFolderNavigation: true, hideSaveAs: false, hideExploreToggle: false, hideSend: false,
    hideSchedule: false, hideBookmarks: false, hideElementInteractions: false, hideTooltip: false,
  };

  const ICON = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12c1-1.5 5-6 10-6s9 4.5 10 6c-1 1.5-5 6-10 6S3 13.5 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  };

  const form = $('editor');
  let tenants = [];
  let selectedId = null;   // null while creating a new company
  let creating = false;
  let baseline = '';
  let editingUserId = null; // null while adding a user in the dialog
  let linksUserId = null;
  let catalogOn = false;    // the read-only Sigma API is configured and reachable

  $('who').textContent = session.username;
  $('signOut').addEventListener('click', () => { if (confirmDiscard()) Portal.signOut(); });

  // Build the interface switches once.
  $('switches').innerHTML = SWITCHES.map(([key, label, param]) => `
    <label class="switch-row">
      <span class="st"><b>${label}</b><code>${param}=true</code></span>
      <input class="switch" type="checkbox" role="switch" name="${key}" id="sw-${key}">
    </label>`).join('');

  // ---------- Small helpers ----------
  let toastTimer;
  function toast(msg, isError) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ');
  const current = () => tenants.find((x) => x.id === selectedId);

  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // Date inputs work in local days; an end date means the end of that day.
  const toDateInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fromDateInput = (v) => {
    if (!v) return null;
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59).toISOString();
  };
  const daysUntil = (iso) => (Date.parse(iso) - Date.now()) / 86400e3;
  function relTime(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return fmtDate(iso);
  }
  function humanTtl(sec) {
    if (sec >= 86400) return plural(Math.round(sec / 86400), 'day');
    if (sec >= 3600) return plural(Math.round(sec / 3600), 'hour');
    return plural(Math.max(1, Math.round(sec / 60)), 'minute');
  }

  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); toast(`${label} copied.`); }
    catch { toast('Copy failed — select the text and copy it manually.', true); }
  }

  function replaceTenant(t) {
    const i = tenants.findIndex((x) => x.id === t.id);
    if (i >= 0) tenants[i] = t; else tenants.push(t);
    tenants.sort((a, b) => a.name.localeCompare(b.name));
  }

  function parseAttrs(text) {
    const out = {};
    text.split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return out;
  }
  const formatAttrs = (attrs) => Object.entries(attrs || {}).map(([k, v]) => `${k}=${v}`).join('\n');

  function tenantBadge(t) {
    if (!t.enabled) return '<span class="badge paused">Paused</span>';
    if (t.expired) return '<span class="badge paused">Access ended</span>';
    return `<span class="badge ${BADGE_CLASS[t.permissions.accessLevel]}">${esc(t.accessLabel)}</span>`;
  }

  // ---------- Views ----------
  const VIEWS = ['manageView', 'embedView', 'devView', 'activityView'];
  let lastCompanyView = 'manageView';
  function showView(id) {
    VIEWS.forEach((v) => { $(v).hidden = v !== id; });
    if (id !== 'activityView') lastCompanyView = id;
    document.querySelectorAll('[data-nav]').forEach((b) => {
      const active = (b.dataset.nav === 'activity') === (id === 'activityView');
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (id !== 'embedView') frame.stop();
  }

  document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.nav === 'activity') {
      if (!confirmDiscard()) return;
      openActivity();
    } else if ($('activityView').hidden === false) {
      if (lastCompanyView === 'embedView' && selectedId) openEmbed(selectedId, embedUserId, embedAppId);
      else if (lastCompanyView === 'devView' && selectedId) openDev(selectedId, devState.user, devState.app);
      else if (selectedId) selectTenant(selectedId);
      else { showView('manageView'); history.replaceState(null, '', location.pathname); }
    }
  }));

  // ---------- Company list ----------
  // Companies can carry a group. Each group collapses independently; which
  // ones are collapsed is a per-browser preference, so a "Live" group can
  // stay hidden while this console is on screen in a demo.
  const COLLAPSED_KEY = 'sigma_admin_collapsed_groups';
  const OTHER = '';
  let collapsedGroups = new Set();
  try { collapsedGroups = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch { /* storage blocked */ }
  const saveCollapsed = () => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedGroups])); } catch {} };

  const groupOf = (t) => t.group || OTHER;
  const groupLabel = (g) => g || 'Other';
  const hasGroups = () => tenants.some((t) => t.group);

  // Group names in display order: alphabetical, ungrouped last.
  function groupNames() {
    const names = [...new Set(tenants.map(groupOf))];
    return names.sort((a, b) => (a === OTHER) - (b === OTHER) || a.localeCompare(b));
  }

  const isHidden = (t) => hasGroups() && collapsedGroups.has(groupOf(t));

  function tenantItem(t) {
    return `
      <li class="tenant-item${t.id === selectedId && !creating ? ' selected' : ''}">
        <button class="tenant-select" type="button" data-select="${esc(t.id)}">
          <span class="dot${t.enabled && !t.expired ? '' : ' off'}" title="${t.enabled && !t.expired ? 'Active' : 'Inactive'}"></span>
          <span class="nm">${esc(t.name)}</span>
          <span class="sub">${tenantBadge(t)}<span>${plural(t.users.length, 'user')} · ${plural(t.apps.length, 'app')}${t.accessEndsAt && !t.expired ? ' · ends ' + esc(fmtDate(t.accessEndsAt)) : ''}</span></span>
        </button>
        <button class="btn btn-ghost tenant-open" type="button" data-open="${esc(t.id)}" title="Open ${esc(t.name)} embed" aria-label="Open ${esc(t.name)} embed">${ICON.open}</button>
      </li>`;
  }

  // Switchers elsewhere in the console follow the same grouping, and leave
  // out collapsed groups (except the company currently open).
  function companyOptions() {
    const byGroup = groupNames().map((g) => [g, tenants.filter((t) => groupOf(t) === g && (!isHidden(t) || t.id === selectedId))]);
    if (!hasGroups()) return tenants.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    return byGroup.filter(([, list]) => list.length).map(([g, list]) =>
      `<optgroup label="${esc(groupLabel(g))}">${list.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const matches = (t) => !q || t.name.toLowerCase().includes(q) || (t.group || '').toLowerCase().includes(q)
      || t.users.some((u) => u.username.includes(q) || fullName(u).toLowerCase().includes(q));
    const shown = tenants.filter(matches);
    $('count').textContent = tenants.length ? `(${tenants.length})` : '';

    const grouped = hasGroups();
    $('groupsToggle').hidden = !grouped;
    if (grouped) {
      const allCollapsed = groupNames().every((g) => collapsedGroups.has(g));
      $('groupsToggle').title = allCollapsed ? 'Expand all groups' : 'Collapse all groups';
      $('groupsToggle').setAttribute('aria-label', $('groupsToggle').title);
      $('groupsToggle').querySelector('svg').style.transform = allCollapsed ? 'rotate(180deg)' : '';
    }

    if (!shown.length) {
      $('tenantList').innerHTML = `<li class="list-empty">${tenants.length ? 'No matches.' : 'No companies yet.'}</li>`;
    } else if (!grouped) {
      $('tenantList').innerHTML = shown.map(tenantItem).join('');
    } else {
      $('tenantList').innerHTML = groupNames().map((g) => {
        const list = shown.filter((t) => groupOf(t) === g);
        if (!list.length) return '';
        const open = !collapsedGroups.has(g);
        return `
          <li class="group-head">
            <button class="group-toggle" type="button" data-group="${esc(g)}" aria-expanded="${open}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              <span class="gn">${esc(groupLabel(g))}</span><span class="gc">${list.length}</span>
            </button>
          </li>
          ${open ? list.map(tenantItem).join('') : ''}`;
      }).join('');
    }

    $('groupOptions').innerHTML = [...new Set(tenants.map((t) => t.group).filter(Boolean))].sort().map((g) => `<option value="${esc(g)}">`).join('');
    $('switcher').innerHTML = companyOptions();
    $('devCompany').innerHTML = $('switcher').innerHTML;
    if (selectedId) { $('switcher').value = selectedId; $('devCompany').value = selectedId; }
    const keep = $('actCompany').value;
    $('actCompany').innerHTML = '<option value="">All companies</option>' + $('switcher').innerHTML;
    $('actCompany').value = keep;
  }

  // The first company in display order whose group is open, if any.
  function firstVisible() {
    for (const g of groupNames()) {
      const t = tenants.filter((x) => groupOf(x) === g).sort((a, b) => a.name.localeCompare(b.name)).find((x) => !isHidden(x));
      if (t) return t;
    }
    return null;
  }

  // Collapsing the group of the company on screen moves the editor off it,
  // so a hidden company never stays visible behind the list.
  function afterCollapse() {
    renderList();
    const t = current();
    if (!t || !isHidden(t) || $('manageView').hidden || isDirty()) return;
    const next = firstVisible();
    if (next) selectTenant(next.id); else showAllCollapsed();
  }

  function showAllCollapsed() {
    showView('manageView');
    form.hidden = true;
    selectedId = null;
    $('emptyState').hidden = false;
    $('listSpinner').hidden = true;
    $('emptyTitle').textContent = 'All companies are in collapsed groups';
    $('emptyTitle').hidden = false;
    $('emptyBody').textContent = 'Expand a group in the list to see its companies.';
    $('emptyBody').hidden = false;
    renderList();
    history.replaceState(null, '', location.pathname);
  }

  $('groupsToggle').addEventListener('click', () => {
    const names = groupNames();
    const allCollapsed = names.every((g) => collapsedGroups.has(g));
    collapsedGroups = allCollapsed ? new Set() : new Set(names);
    saveCollapsed();
    afterCollapse();
  });

  $('tenantList').addEventListener('click', (e) => {
    const grp = e.target.closest('[data-group]');
    if (grp) {
      const g = grp.dataset.group;
      if (collapsedGroups.has(g)) collapsedGroups.delete(g); else collapsedGroups.add(g);
      saveCollapsed();
      return afterCollapse();
    }
    const sel = e.target.closest('[data-select]');
    const open = e.target.closest('[data-open]');
    if (sel && confirmDiscard()) selectTenant(sel.dataset.select);
    if (open && confirmDiscard()) openEmbed(open.dataset.open);
  });
  $('search').addEventListener('input', renderList);

  // ---------- Apps editor ----------
  function appRowHtml(a) {
    return `
      <li class="app-row" data-app-row="${esc(a.id || '')}">
        <span class="app-ic" data-ic>${AppIcons.svg(a.icon)}</span>
        <select class="input app-icon-select" data-f="icon" aria-label="Icon">
          ${AppIcons.keys.map((k) => `<option value="${k}"${k === (a.icon || 'dashboard') ? ' selected' : ''}>${esc(AppIcons.label(k))}</option>`).join('')}
        </select>
        <input class="input app-name" data-f="name" type="text" placeholder="App name" value="${esc(a.name || '')}" aria-label="App name">
        <select class="input app-mode" data-f="mode" aria-label="What to embed">
          ${Object.entries(MODE_LABELS).map(([k, l]) => `<option value="${k}"${k === (a.mode || 'workbook') ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <span class="app-actions">
          <button class="btn btn-ghost icon-btn" type="button" data-move="-1" title="Move up" aria-label="Move up">${ICON.up}</button>
          <button class="btn btn-ghost icon-btn" type="button" data-move="1" title="Move down" aria-label="Move down">${ICON.down}</button>
          <button class="btn btn-ghost btn-danger icon-btn" type="button" data-remove title="Remove app" aria-label="Remove app">${ICON.trash}</button>
        </span>
        <div class="wide url-row">
          <input class="input" data-f="url" type="url" placeholder="https://app.sigmacomputing.com/your-org/workbook/…" value="${esc(a.url || '')}" aria-label="Sigma URL" autocomplete="off" spellcheck="false">
          <button class="btn" type="button" data-browse${catalogOn ? '' : ' hidden'}>Browse Sigma</button>
        </div>
        <input class="input wide" data-f="description" type="text" placeholder="Short description shown in the launcher (optional)" value="${esc(a.description || '')}" aria-label="Description">
        <span class="app-hint" data-hint></span>
      </li>`;
  }

  function renderApps(apps) {
    $('appsList').innerHTML = apps.map(appRowHtml).join('');
    syncApps();
  }

  function readApps() {
    return [...$('appsList').querySelectorAll('[data-app-row]')].map((r) => {
      const f = (k) => r.querySelector(`[data-f="${k}"]`).value.trim();
      const a = { icon: f('icon'), name: f('name'), mode: f('mode'), url: f('url'), description: f('description') };
      if (r.dataset.appRow) a.id = r.dataset.appRow;
      return a;
    });
  }

  // Per-row hints: what the URL will render, or what's missing.
  function syncApps() {
    const rows = [...$('appsList').querySelectorAll('[data-app-row]')];
    $('appCount').textContent = `(${rows.length})`;
    rows.forEach((r, i) => {
      r.querySelector('[data-ic]').innerHTML = AppIcons.svg(r.querySelector('[data-f="icon"]').value);
      r.querySelector('[data-move="-1"]').disabled = i === 0;
      r.querySelector('[data-move="1"]').disabled = i === rows.length - 1;
      r.querySelector('[data-remove]').disabled = rows.length === 1;
      const url = r.querySelector('[data-f="url"]').value.trim();
      const mode = r.querySelector('[data-f="mode"]').value;
      const node = (url.match(/\/(?:page|element)\/([^/?#]+)/) || url.match(/[?&]:nodeId=([^&#]+)/) || [])[1];
      const hint = r.querySelector('[data-hint]');
      let msg = '';
      let warn = false;
      if (!url) msg = 'Paste a link to a Sigma workbook, page or element.';
      else if (mode !== 'workbook' && !node) { msg = `This link has no ${mode} id. Select the ${mode} in Sigma and copy the URL (it includes :nodeId).`; warn = true; }
      else if (mode === 'workbook') msg = node ? `Whole workbook, opening on page ${node}.` : 'Whole workbook, opening on its first page.';
      else msg = `Only the ${mode} ${node}.`;
      hint.textContent = msg;
      hint.classList.toggle('warn', warn);
    });
  }

  $('appsList').addEventListener('input', (e) => {
    const row = e.target.closest('[data-app-row]');
    // A pasted /page/ or /element/ link picks its mode automatically.
    if (row && e.target.dataset.f === 'url') {
      const m = e.target.value.match(/\/(page|element)\/[^/?#]+/);
      if (m) row.querySelector('[data-f="mode"]').value = m[1];
    }
    syncApps();
  });
  $('appsList').addEventListener('change', syncApps);
  $('appsList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-app-row]');
    if (!row) return;
    if (e.target.closest('[data-browse]')) return openPicker(row);
    const move = e.target.closest('[data-move]');
    if (move) {
      const sib = move.dataset.move === '-1' ? row.previousElementSibling : row.nextElementSibling;
      if (sib) { if (move.dataset.move === '-1') sib.before(row); else sib.after(row); }
    }
    if (e.target.closest('[data-remove]')) row.remove();
    syncApps();
    syncUi();
  });
  $('addAppBtn').addEventListener('click', () => {
    $('appsList').insertAdjacentHTML('beforeend', appRowHtml({ icon: 'dashboard', mode: 'workbook' }));
    syncApps();
    syncUi();
    $('appsList').lastElementChild.querySelector('[data-f="name"]').focus();
  });

  // ---------- Company form <-> data ----------
  function fillForm(t) {
    const p = { ...DEFAULTS, ...(t.permissions || {}) };
    form.querySelector(`input[name="accessLevel"][value="${p.accessLevel}"]`).checked = true;
    $('customAccountType').value = p.customAccountType || '';
    $('menuPosition').value = p.menuPosition;
    $('sessionLength').value = String(p.sessionLength);
    if (!$('sessionLength').value) $('sessionLength').value = '3600';
    $('theme').value = p.theme || '';
    $('lng').value = p.lng || '';
    SWITCHES.forEach(([key]) => { $('sw-' + key).checked = !!p[key]; });
    $('enabled').checked = t.enabled !== false;
    $('accessEndsAt').value = toDateInput(t.accessEndsAt);
    renderApps(t.apps && t.apps.length ? t.apps : [{ icon: 'dashboard', mode: 'workbook', name: 'Overview' }]);
    $('teams').value = (t.teams || []).join(', ');
    $('userAttributes').value = formatAttrs(t.userAttributes);
    $('dispName').value = t.name || '';
    $('group').value = t.group || '';
    $('formError').hidden = true;
    baseline = JSON.stringify(readForm());
    renderUsers();
    syncUi();
  }

  function readForm() {
    const permissions = {
      accessLevel: form.querySelector('input[name="accessLevel"]:checked')?.value || 'view',
      customAccountType: $('customAccountType').value.trim(),
      menuPosition: $('menuPosition').value,
      sessionLength: parseInt($('sessionLength').value, 10),
      theme: $('theme').value.trim(),
      lng: $('lng').value.trim(),
    };
    SWITCHES.forEach(([key]) => { permissions[key] = $('sw-' + key).checked; });
    return {
      name: $('dispName').value.trim(),
      group: $('group').value.trim(),
      enabled: $('enabled').checked,
      accessEndsAt: fromDateInput($('accessEndsAt').value),
      apps: readApps(),
      teams: $('teams').value.split(',').map((s) => s.trim()).filter(Boolean),
      userAttributes: parseAttrs($('userAttributes').value),
      permissions,
    };
  }

  const isDirty = () => !form.hidden && !$('manageView').hidden && JSON.stringify(readForm()) !== baseline;

  function confirmDiscard() {
    return !isDirty() || confirm('You have unsaved changes. Discard them?');
  }

  // The account type a user would get under the form's current (maybe
  // unsaved) company default.
  function userAccess(u, companyLevel, companyCustom) {
    const inherited = u.accessLevel === 'inherit';
    const level = inherited ? companyLevel : u.accessLevel;
    const custom = inherited ? companyCustom : u.customAccountType;
    return { inherited, level, label: LEVEL_LABELS[level], accountType: level === 'custom' ? (custom || '<account type>') : ACCOUNT_TYPES[level] };
  }

  // Keeps the header, hints, user list and signed-embed preview in step with the form.
  function syncUi() {
    const f = readForm();
    const p = f.permissions;
    const t = current();

    $('customAcctField').hidden = p.accessLevel !== 'custom';
    $('enabledHint').textContent = f.enabled
      ? 'This company’s users can sign in and load its embed.'
      : 'Paused: none of this company’s users can sign in. You can still open the embed here.';
    const endsHint = $('accessEndsHint');
    const past = f.accessEndsAt && Date.parse(f.accessEndsAt) <= Date.now();
    endsHint.textContent = past
      ? 'This date has passed: every user in this company is locked out. You can still preview the embed here.'
      : f.accessEndsAt
        ? `Sign-in stops at the end of ${fmtDate(f.accessEndsAt)} for every user in the company; sessions and embeds end then too.`
        : 'For a time-boxed proof of value. Leave empty for no end date.';
    endsHint.classList.toggle('warn', !!past);

    $('dName').textContent = creating ? (f.name || 'New company') : (t ? t.name : '');
    $('dEyebrow').textContent = creating ? 'Add company' : 'Company';
    $('deleteBtn').hidden = creating;
    $('openBtn').hidden = creating;
    $('saveBtn').textContent = creating ? 'Create company' : 'Save changes';

    if (creating) {
      $('dMeta').innerHTML = '<span>Fill in the details, create the company, then add its users.</span>';
    } else if (t) {
      const when = t.updatedAt ? fmtDateTime(t.updatedAt) : '—';
      $('dMeta').innerHTML = tenantBadge(t)
        + `<span>${plural(t.users.length, 'user')} · ${plural(t.apps.length, 'app')}</span>`
        + (t.accessEndsAt && !t.expired ? `<span>Access ends ${esc(fmtDate(t.accessEndsAt))}</span>` : '')
        + `<span>Last saved ${esc(when)}${t.updatedBy ? ' by ' + esc(t.updatedBy) : ''}</span>`;
    }

    const dirty = isDirty();
    $('dirtyNote').textContent = creating ? 'Not created yet' : dirty ? 'Unsaved changes' : 'All changes saved';
    $('dirtyNote').classList.toggle('dirty', dirty || creating);
    $('discardBtn').disabled = !dirty && !creating;
    $('saveBtn').disabled = !dirty && !creating;

    // Users inheriting the default follow the form live, so the list never
    // disagrees with the access cards above it.
    document.querySelectorAll('[data-user-access]').forEach((el) => {
      const u = (t ? t.users : []).find((x) => x.id === el.dataset.userAccess);
      if (!u) return;
      const a = userAccess(u, p.accessLevel, p.customAccountType);
      el.innerHTML = `<span class="badge ${BADGE_CLASS[a.level]}">${esc(a.label)}</span><small>${a.inherited ? 'Company default' : 'Set for user'} · ${esc(a.accountType)}</small>`;
    });

    // Signed embed preview, for the chosen user
    const users = t && !creating ? t.users : [];
    const pick = users.find((u) => u.id === $('previewAs').value) || users[0];
    const claims = pick
      ? (() => {
          const a = userAccess(pick, p.accessLevel, p.customAccountType);
          const c = { sub: pick.embedEmail, account_type: a.accountType, teams: f.teams, first_name: pick.firstName };
          if (pick.lastName) c.last_name = pick.lastName;
          const attrs = { ...f.userAttributes, ...pick.userAttributes };
          if (Object.keys(attrs).length) c.user_attributes = attrs;
          c.exp = `now + ${p.sessionLength}s`;
          return c;
        })()
      : { sub: '<add a user>', account_type: p.accessLevel === 'custom' ? (p.customAccountType || '<account type>') : ACCOUNT_TYPES[p.accessLevel], teams: f.teams, exp: `now + ${p.sessionLength}s` };
    const params = [':embed=true', `:menu_position=${p.menuPosition}`]
      .concat(SWITCHES.filter(([key]) => p[key]).map(([, , param]) => `${param}=true`));
    if (p.theme) params.push(`:theme=${p.theme}`);
    if (p.lng) params.push(`:lng=${p.lng}`);
    $('preview').innerHTML = '<span class="k">JWT claims</span>\n' + esc(JSON.stringify(claims, null, 2))
      + '\n\n<span class="k">URL parameters</span>\n' + esc(params.join('\n'))
      + '\n\nThe Developer view shows the full signed URL and server code.';
  }

  form.addEventListener('input', syncUi);
  form.addEventListener('change', syncUi);

  // ---------- Users ----------
  function userEndsLine(u) {
    const end = u.state && u.state.endsAt;
    if (u.state && u.state.reason === 'expired') return `<div class="uends warn">Access ended ${esc(fmtDate(end))}</div>`;
    if (!end) return '';
    const d = daysUntil(end);
    return `<div class="uends${d < 7 ? ' soon' : ''}">Access ends ${esc(fmtDate(end))}${u.accessEndsAt ? '' : ' (company date)'}</div>`;
  }

  function renderUsers() {
    const t = creating ? null : current();
    const users = t ? t.users : [];
    $('usersNote').hidden = !creating;
    $('addUserBtn').disabled = creating;
    $('userCount').textContent = t ? `(${users.length})` : '';
    $('usersList').innerHTML = !t ? '' : users.length ? users.map((u) => {
      const initials = ((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '');
      const attrs = Object.entries(u.userAttributes || {});
      const activeLinks = (u.links || []).filter((l) => l.status === 'active').length;
      const off = !u.enabled || (u.state && u.state.reason === 'expired');
      return `
        <li class="user-row${off ? ' off' : ''}">
          <span class="avatar" aria-hidden="true">${esc(initials.toUpperCase() || '?')}</span>
          <div class="user-main">
            <div class="un">${esc(fullName(u))}${u.enabled ? '' : ' <span class="badge paused">Paused</span>'}${u.passwordLogin ? '' : ' <span class="badge custom">Links only</span>'}${activeLinks ? ` <span class="badge active">${plural(activeLinks, 'active link')}</span>` : ''}</div>
            <div class="ue">${esc(u.username)} · ${esc(u.embedEmail)}</div>
            ${userEndsLine(u)}
            ${attrs.length ? `<div class="attrs">${attrs.map(([k, v]) => `<span class="chip">${esc(k)}=${esc(v)}</span>`).join('')}</div>` : ''}
          </div>
          <div class="user-access" data-user-access="${esc(u.id)}"></div>
          <div class="user-actions">
            <button class="btn btn-ghost icon-btn" type="button" data-user-open="${esc(u.id)}" title="Open embed as ${esc(fullName(u))}" aria-label="Open embed as ${esc(fullName(u))}">${ICON.eye}</button>
            <button class="btn btn-ghost icon-btn" type="button" data-user-dev="${esc(u.id)}" title="Developer view for ${esc(fullName(u))}" aria-label="Developer view for ${esc(fullName(u))}">${ICON.code}</button>
            <button class="btn btn-ghost icon-btn" type="button" data-user-links="${esc(u.id)}" title="Sign-in links for ${esc(fullName(u))}" aria-label="Sign-in links for ${esc(fullName(u))}">${ICON.link}</button>
            <button class="btn btn-ghost icon-btn" type="button" data-user-edit="${esc(u.id)}" title="Edit ${esc(fullName(u))}" aria-label="Edit ${esc(fullName(u))}">${ICON.edit}</button>
            <button class="btn btn-ghost btn-danger icon-btn" type="button" data-user-delete="${esc(u.id)}" title="Delete ${esc(fullName(u))}" aria-label="Delete ${esc(fullName(u))}">${ICON.trash}</button>
          </div>
        </li>`;
    }).join('') : '<li class="users-empty">No users yet. Add one so this company can sign in.</li>';

    const keep = $('previewAs').value;
    $('previewAs').innerHTML = users.length
      ? users.map((u) => `<option value="${esc(u.id)}">Preview as ${esc(fullName(u))}</option>`).join('')
      : '<option value="">No users yet</option>';
    if (users.some((u) => u.id === keep)) $('previewAs').value = keep;
    $('previewAs').disabled = !users.length;
  }

  $('previewAs').addEventListener('change', syncUi);

  $('usersList').addEventListener('click', async (e) => {
    const t = current();
    if (!t) return;
    const pick = (attr) => { const b = e.target.closest(`[${attr}]`); return b && t.users.find((u) => u.id === b.getAttribute(attr)); };
    const unsavedOk = () => !isDirty() || confirm('You have unsaved changes. The embed uses the last saved settings. Continue?');

    const edit = pick('data-user-edit');
    if (edit) return openUserDialog(edit);
    const links = pick('data-user-links');
    if (links) return openLinks(links);
    const open = pick('data-user-open');
    if (open && unsavedOk()) return openEmbed(t.id, open.id);
    const dev = pick('data-user-dev');
    if (dev && unsavedOk()) return openDev(t.id, dev.id);
    const del = pick('data-user-delete');
    if (del && confirm(`Delete ${fullName(del)}? Their sign-in and links stop working immediately. Nothing in Sigma is changed.`)) {
      try {
        const res = await Portal.api(`/api/tenants/${encodeURIComponent(t.id)}/users/${encodeURIComponent(del.id)}`, { method: 'DELETE' });
        replaceTenant(res.tenant);
        renderList();
        renderUsers();
        syncUi();
        toast(`${fullName(del)} deleted.`);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  // ---------- User dialog ----------
  const dialog = $('userDialog');

  function openUserDialog(u) {
    const t = current();
    editingUserId = u ? u.id : null;
    $('userDialogCompany').textContent = t.name;
    $('userDialogTitle').textContent = u ? 'Edit user' : 'Add user';
    $('uSave').textContent = u ? 'Save user' : 'Add user';
    $('uPasswordLabel').textContent = u && u.passwordLogin ? 'Reset password' : 'Password';
    $('uPassword').placeholder = u && u.passwordLogin ? 'Leave blank to keep the current password' : 'Choose a password';
    const companyLevel = form.querySelector('input[name="accessLevel"]:checked')?.value || t.permissions.accessLevel;
    $('uInheritOption').textContent = `Company default (${LEVEL_LABELS[companyLevel]})`;
    $('uFirst').value = u ? u.firstName || '' : '';
    $('uLast').value = u ? u.lastName || '' : '';
    $('uUsername').value = u ? u.username : '';
    $('uMethod').value = u && !u.passwordLogin ? 'link' : 'password';
    $('uPassword').value = '';
    $('uEnds').value = u ? toDateInput(u.accessEndsAt) : '';
    $('uEmail').value = u ? u.embedEmail : '';
    $('uAccess').value = u ? u.accessLevel : 'inherit';
    $('uCustom').value = u ? u.customAccountType || '' : '';
    $('uAttrs').value = u ? formatAttrs(u.userAttributes) : '';
    $('uEnabled').checked = u ? u.enabled !== false : true;
    const companyAttrs = formatAttrs(t.userAttributes).split('\n').filter(Boolean).join(', ');
    $('uAttrsHint').innerHTML = 'One <code>attribute=value</code> per line. Overrides the company value of the same name. The attribute must exist in Sigma first, or Sigma refuses the sign-in.'
      + (companyAttrs ? ` Company sends: <code>${esc(companyAttrs)}</code>` : '');
    $('userError').hidden = true;
    syncUserDialog();
    dialog.showModal();
    $('uFirst').focus();
  }

  function syncUserDialog() {
    const t = current();
    $('uCustomField').hidden = $('uAccess').value !== 'custom';
    const linkOnly = $('uMethod').value === 'link';
    $('uPasswordField').hidden = linkOnly;
    $('uMethodHint').textContent = linkOnly
      ? 'No password: this user can only sign in with a link you create from the Users list.'
      : 'Sign-in links can also be added for this user from the Users list.';
    const own = fromDateInput($('uEnds').value);
    const company = t && t.accessEndsAt;
    $('uEndsHint').textContent = own && Date.parse(own) <= Date.now()
      ? 'This date has passed: the user is locked out.'
      : company
        ? `The company’s access ends ${fmtDate(company)}; the earlier of the two dates applies.`
        : 'Leave empty for no end date.';
    $('uEndsHint').classList.toggle('warn', !!(own && Date.parse(own) <= Date.now()));
  }
  ['uAccess', 'uMethod', 'uEnds'].forEach((id) => $(id).addEventListener('change', syncUserDialog));
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = current();
    const linkOnly = $('uMethod').value === 'link';
    const body = {
      firstName: $('uFirst').value.trim(),
      lastName: $('uLast').value.trim(),
      username: $('uUsername').value.trim().toLowerCase(),
      embedEmail: $('uEmail').value.trim().toLowerCase(),
      accessLevel: $('uAccess').value,
      customAccountType: $('uCustom').value.trim(),
      userAttributes: parseAttrs($('uAttrs').value),
      enabled: $('uEnabled').checked,
      accessEndsAt: fromDateInput($('uEnds').value),
      passwordLogin: !linkOnly,
    };
    if (!linkOnly && $('uPassword').value) body.password = $('uPassword').value;
    $('uSave').disabled = true;
    $('userError').hidden = true;
    try {
      const base = `/api/tenants/${encodeURIComponent(t.id)}/users`;
      const res = editingUserId
        ? await Portal.api(`${base}/${encodeURIComponent(editingUserId)}`, { method: 'PUT', body: JSON.stringify(body) })
        : await Portal.api(base, { method: 'POST', body: JSON.stringify(body) });
      replaceTenant(res.tenant);
      dialog.close();
      renderList();
      renderUsers();
      syncUi();
      const u = res.user;
      if (!editingUserId && linkOnly) {
        toast(`${fullName(u)} added. Create a sign-in link so they can get in.`);
        openLinks(current().users.find((x) => x.id === u.id));
      } else {
        toast(editingUserId
          ? `Saved. ${fullName(u)} gets ${u.access.label} from their next sign-in.`
          : `${fullName(u)} added. They sign in as “${u.username}”.`);
      }
    } catch (err) {
      $('userError').textContent = err.message;
      $('userError').hidden = false;
    } finally {
      $('uSave').disabled = false;
    }
  });

  $('addUserBtn').addEventListener('click', () => { if (current()) openUserDialog(null); });

  // ---------- Sign-in links dialog ----------
  const linksDialog = $('linksDialog');
  const LINK_BADGE = { active: 'Active', used: 'Used', expired: 'Expired', revoked: 'Revoked' };

  function linksUser() {
    const t = current();
    return t && t.users.find((u) => u.id === linksUserId);
  }

  function renderLinks() {
    const u = linksUser();
    if (!u) return;
    const end = u.state && u.state.endsAt;
    const opt = $('linkExpiry').querySelector('option[value="access-end"]');
    opt.disabled = !end;
    opt.textContent = end ? `When their access ends (${fmtDate(end)})` : 'When their access ends (no end date set)';
    if (opt.disabled && $('linkExpiry').value === 'access-end') $('linkExpiry').value = '604800';
    const links = [...(u.links || [])].reverse();
    $('linksList').innerHTML = links.length ? links.map((l) => `
      <li>
        <span class="badge ${l.status}">${LINK_BADGE[l.status]}</span>
        <span class="lm">${l.singleUse ? 'Single use' : 'Reusable'} · ${plural(l.uses || 0, 'sign-in')}
          <small>Created ${esc(fmtDateTime(l.createdAt))}${l.createdBy ? ' by ' + esc(l.createdBy) : ''} · ${l.status === 'active' ? 'expires' : 'expiry'} ${esc(fmtDateTime(l.expiresAt))}${l.usedAt ? ' · last used ' + esc(relTime(l.usedAt)) : ''}</small>
        </span>
        ${l.status === 'active' ? `<button class="btn btn-danger" type="button" data-revoke="${esc(l.id)}">Revoke</button>` : ''}
      </li>`).join('') : '<li class="none">No links yet.</li>';
  }

  function openLinks(u) {
    linksUserId = u.id;
    $('linksCompany').textContent = current().name;
    $('linksTitle').textContent = `Sign-in links for ${fullName(u)}`;
    $('newLink').hidden = true;
    $('newLinkUrl').value = '';
    $('linkError').hidden = true;
    $('linkSingle').checked = false;
    renderLinks();
    linksDialog.showModal();
  }

  $('linkCreate').addEventListener('click', async () => {
    const t = current();
    const u = linksUser();
    $('linkError').hidden = true;
    $('linkCreate').disabled = true;
    try {
      const v = $('linkExpiry').value;
      const res = await Portal.api(`/api/tenants/${encodeURIComponent(t.id)}/users/${encodeURIComponent(u.id)}/links`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn: v === 'access-end' ? 'access-end' : parseInt(v, 10), singleUse: $('linkSingle').checked }),
      });
      replaceTenant(res.tenant);
      $('newLinkUrl').value = `${location.origin}/#link=${res.token}`;
      $('newLink').hidden = false;
      $('newLinkUrl').select();
      renderLinks();
      renderUsers();
      syncUi();
    } catch (err) {
      $('linkError').textContent = err.message;
      $('linkError').hidden = false;
    } finally {
      $('linkCreate').disabled = false;
    }
  });

  $('linksList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-revoke]');
    if (!b) return;
    const t = current();
    try {
      const res = await Portal.api(`/api/tenants/${encodeURIComponent(t.id)}/users/${encodeURIComponent(linksUserId)}/links/${encodeURIComponent(b.dataset.revoke)}`, { method: 'DELETE' });
      replaceTenant(res.tenant);
      renderLinks();
      renderUsers();
      syncUi();
      toast('Link revoked.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy-input]');
    if (b) copyText($(b.dataset.copyInput).value, 'Link');
  });

  // ---------- Selecting / creating companies ----------
  function showEditor() {
    $('emptyState').hidden = true;
    form.hidden = false;
    $('detailPane').scrollTop = 0;
  }

  function selectTenant(id) {
    const t = tenants.find((x) => x.id === id);
    if (!t) return;
    creating = false;
    selectedId = id;
    showView('manageView');
    fillForm(t);
    showEditor();
    renderList();
    history.replaceState(null, '', '#edit/' + encodeURIComponent(id));
  }

  function startCreate() {
    creating = true;
    selectedId = null;
    showView('manageView');
    fillForm({ enabled: true, permissions: DEFAULTS, teams: [], userAttributes: {}, users: [], apps: [] });
    showEditor();
    renderList();
    $('dispName').focus();
    history.replaceState(null, '', '#new');
  }

  $('addBtn').addEventListener('click', () => { if (confirmDiscard()) startCreate(); });
  $('discardBtn').addEventListener('click', () => {
    if (creating) {
      creating = false;
      if (!tenants.length) showEmpty(); else if (selectedId || firstVisible()) selectTenant(selectedId || firstVisible().id); else showAllCollapsed();
    } else {
      selectTenant(selectedId);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = readForm();
    $('saveBtn').disabled = true;
    $('formError').hidden = true;
    try {
      const saved = creating
        ? await Portal.api('/api/tenants', { method: 'POST', body: JSON.stringify(body) })
        : await Portal.api('/api/tenants/' + encodeURIComponent(selectedId), { method: 'PUT', body: JSON.stringify(body) });
      const wasCreating = creating;
      replaceTenant(saved);
      selectTenant(saved.id);
      if (wasCreating) {
        toast(`${saved.name} created. Now add its users.`);
        $('usersCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else {
        toast(saved.enabled
          ? `Saved. ${saved.name}’s users get the new settings from their next sign-in.`
          : `Saved. ${saved.name} is paused.`);
      }
    } catch (err) {
      $('formError').textContent = err.message;
      $('formError').hidden = false;
      $('formError').scrollIntoView({ block: 'center', behavior: 'smooth' });
      syncUi();
    }
  });

  $('deleteBtn').addEventListener('click', async () => {
    const t = current();
    if (!t || !confirm(`Delete ${t.name} and its ${plural(t.users.length, 'user')}? Their sign-ins stop working immediately. Nothing in Sigma is changed.`)) return;
    try {
      await Portal.api('/api/tenants/' + encodeURIComponent(t.id), { method: 'DELETE' });
      tenants = tenants.filter((x) => x.id !== t.id);
      baseline = JSON.stringify(readForm()); // nothing left to discard
      toast(`${t.name} deleted.`);
      if (!tenants.length) showEmpty(); else if (firstVisible()) selectTenant(firstVisible().id); else showAllCollapsed();
    } catch (err) {
      toast(err.message, true);
    }
  });

  function showEmpty() {
    showView('manageView');
    form.hidden = true;
    selectedId = null;
    $('emptyState').hidden = false;
    $('listSpinner').hidden = true;
    $('emptyTitle').textContent = 'No companies yet';
    $('emptyTitle').hidden = false;
    $('emptyBody').textContent = 'Add a company to give it a sign-in and route it to its Sigma embed.';
    $('emptyBody').hidden = false;
    renderList();
    history.replaceState(null, '', location.pathname);
  }

  // ---------- Embed view ----------
  let embedUserId = null;
  let embedAppId = null;

  // EmbedFrame names the company; the admin's "view as" user and app ride
  // along on the same request.
  const frame = EmbedFrame({
    iframe: $('sigmaEmbed'),
    loading: $('loadingState'),
    error: $('errorState'),
    errorMessage: $('errorMessage'),
    query: () => ({ ...(embedUserId ? { user: embedUserId } : {}), ...(embedAppId ? { app: embedAppId } : {}) }),
    onSigned: (data) => {
      const t = data.tenant;
      const u = data.user;
      embedUserId = u.id;
      embedAppId = data.app.id;
      $('userSwitcher').value = u.id;
      $('appSwitcher').value = data.app.id;
      const paused = !t.enabled ? ' · company paused'
        : !u.enabled ? ' · user paused'
          : u.state === 'expired' ? ' · access ended' : '';
      $('embedBadge').textContent = t.accessLabel + paused;
      $('embedBadge').className = 'badge ' + (paused ? 'paused' : BADGE_CLASS[t.accessLevel]);
      $('embedAs').innerHTML = `Signed in as <code>${esc(u.embedEmail)}</code> with <code>${esc(t.accountType)}</code>, exactly as ${esc(fullName(u))} sees it`;
    },
  });

  function fillPickers(t, userSel, appSel, userPrefix) {
    userSel.innerHTML = t.users.length
      ? t.users.map((u) => `<option value="${esc(u.id)}">${userPrefix}${esc(fullName(u))}</option>`).join('')
      : '<option value="">No users</option>';
    userSel.disabled = !t.users.length;
    appSel.innerHTML = t.apps.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
    appSel.disabled = t.apps.length < 2;
  }

  const pickId = (list, id) => (id && list.some((x) => x.id === id) ? id : (list[0] || {}).id || null);

  function openEmbed(id, userId, appId) {
    const t = tenants.find((x) => x.id === id);
    if (!t) return;
    selectedId = id;
    creating = false;
    embedUserId = pickId(t.users, userId);
    embedAppId = pickId(t.apps, appId);
    renderList(); // keeps this company in the switcher even if its group is collapsed
    showView('embedView');
    $('switcher').value = id;
    fillPickers(t, $('userSwitcher'), $('appSwitcher'), 'View as ');
    if (embedUserId) $('userSwitcher').value = embedUserId;
    if (embedAppId) $('appSwitcher').value = embedAppId;
    $('embedBadge').textContent = '';
    $('embedAs').textContent = '';
    frame.load(id);
    history.replaceState(null, '', `#embed/${encodeURIComponent(id)}/${encodeURIComponent(embedUserId || '')}/${encodeURIComponent(embedAppId || '')}`);
  }

  $('openBtn').addEventListener('click', () => {
    if (isDirty() && !confirm('You have unsaved changes. The embed opens with the last saved settings. Continue?')) return;
    openEmbed(selectedId, $('previewAs').value);
  });
  $('switcher').addEventListener('change', (e) => openEmbed(e.target.value));
  $('userSwitcher').addEventListener('change', (e) => openEmbed(selectedId, e.target.value, embedAppId));
  $('appSwitcher').addEventListener('change', (e) => openEmbed(selectedId, embedUserId, e.target.value));
  $('backBtn').addEventListener('click', () => selectTenant(selectedId));
  $('editBtn').addEventListener('click', () => selectTenant(selectedId));
  $('devBtn').addEventListener('click', () => openDev(selectedId, embedUserId, embedAppId));
  $('reloadBtn').addEventListener('click', () => frame.load());
  $('retry').addEventListener('click', () => frame.load());

  // ---------- Developer view ----------
  const devState = { tenant: null, user: null, app: null, lang: 'node', analysis: null };
  const devRaw = {};

  function openDev(id, userId, appId) {
    const t = tenants.find((x) => x.id === id);
    if (!t) return;
    selectedId = id;
    creating = false;
    devState.tenant = id;
    devState.user = pickId(t.users, userId);
    devState.app = pickId(t.apps, appId);
    renderList();
    showView('devView');
    $('devCompany').value = id;
    fillPickers(t, $('devUser'), $('devApp'), '');
    if (devState.user) $('devUser').value = devState.user;
    if (devState.app) $('devApp').value = devState.app;
    history.replaceState(null, '', `#dev/${encodeURIComponent(id)}/${encodeURIComponent(devState.user || '')}/${encodeURIComponent(devState.app || '')}`);
    signDev();
  }

  async function signDev() {
    $('devError').hidden = true;
    try {
      const qs = new URLSearchParams({ tenant: devState.tenant, purpose: 'developer' });
      if (devState.user) qs.set('user', devState.user);
      if (devState.app) qs.set('app', devState.app);
      const data = await Portal.api('/api/embed-url?' + qs.toString());
      renderDev(data);
    } catch (err) {
      $('devError').textContent = err.message;
      $('devError').hidden = false;
    }
  }

  function renderDev(data) {
    const a = DevView.analyse(data.url);
    devState.analysis = a;
    const u = data.user;
    $('devWho').textContent = `${fullName(u)} (${u.embedEmail}) · ${data.tenant.name} · ${data.app.name}`;
    $('devTtl').textContent = humanTtl(a.payload.exp - a.payload.iat);

    // 1. URL
    const pv = (p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; };
    $('devUrl').innerHTML = `<span class="u-base">${esc(a.base)}</span>?`
      + [...a.params.filter((p) => p.startsWith(':nodeId')), `:jwt=${a.jwt}`, ...a.params.filter((p) => !p.startsWith(':nodeId'))]
        .map((p) => (p.startsWith(':jwt=') ? `<span class="u-jwt">${esc(p)}</span>` : `<span class="u-param">${esc(p)}</span>`)).join('&amp;');
    devRaw.devUrlRaw = data.url;
    const rows = [[`URL (${MODE_LABELS[data.app.mode].toLowerCase()})`, a.base, DevView.MODE_DOCS[data.app.mode]],
      [':jwt', a.jwt.slice(0, 24) + '…', DevView.PARAM_DOCS[':jwt']],
      ...a.params.map((p) => { const [k, v] = pv(p); return [k, v, DevView.PARAM_DOCS[k] || '']; })];
    $('devParams').innerHTML = '<thead><tr><th>Part</th><th>Value</th><th>What it does</th></tr></thead><tbody>'
      + rows.map(([k, v, d]) => `<tr><td>${esc(k)}</td><td class="v">${esc(v)}</td><td class="d">${esc(d)}</td></tr>`).join('') + '</tbody>';

    // 2. JWT
    const [h, p, s] = a.segments;
    $('devJwt').innerHTML = `<span class="j-h">${esc(h)}</span>.<span class="j-p">${esc(p)}</span>.<span class="j-s">${esc(s)}</span>`;
    devRaw.devJwtRaw = a.jwt;
    $('devHeader').textContent = JSON.stringify(a.header, null, 2);
    $('devClaims').innerHTML = '<thead><tr><th>Claim</th><th>Value</th><th>Meaning</th></tr></thead><tbody>'
      + Object.entries(a.payload).map(([k, v]) => {
        const shown = (k === 'iat' || k === 'exp') ? `${v} (${fmtDateTime(new Date(v * 1000).toISOString())})` : (typeof v === 'string' ? v : JSON.stringify(v));
        return `<tr><td>${esc(k)}</td><td class="v">${esc(shown)}</td><td class="d">${esc(DevView.CLAIM_DOCS[k] || '')}</td></tr>`;
      }).join('') + '</tbody>';

    renderDevCode();
    $('devFront').textContent = DevView.frontend(a);
    devRaw.devFrontRaw = $('devFront').textContent;
  }

  function renderDevCode() {
    if (!devState.analysis) return;
    const { code, dep } = DevView.code[devState.lang](devState.analysis);
    $('devCode').textContent = code;
    $('devDep').innerHTML = `Install: <code>${esc(dep)}</code>`;
    devRaw.devCodeRaw = code;
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lang === devState.lang)));
  }

  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { devState.lang = b.dataset.lang; renderDevCode(); }));
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    const labels = { devUrlRaw: 'Signed URL', devJwtRaw: 'JWT', devCodeRaw: 'Code', devFrontRaw: 'Snippet' };
    if (devRaw[b.dataset.copy]) copyText(devRaw[b.dataset.copy], labels[b.dataset.copy]);
  }));
  $('devCompany').addEventListener('change', (e) => openDev(e.target.value));
  $('devUser').addEventListener('change', (e) => openDev(devState.tenant, e.target.value, devState.app));
  $('devApp').addEventListener('change', (e) => openDev(devState.tenant, devState.user, e.target.value));
  $('devRegen').addEventListener('click', signDev);
  $('devOpen').addEventListener('click', () => openEmbed(devState.tenant, devState.user, devState.app));
  $('devBackBtn').addEventListener('click', () => selectTenant(devState.tenant));

  // ---------- Activity ----------
  let actEvents = [];
  let actNext = null;
  let actTotal = 0;

  const EVENT_INFO = {
    'signin.success': ['Signed in', 'signin'],
    'signin.failed': ['Sign-in failed', 'failed'],
    'embed.open': ['Opened app', 'embed'],
    'admin.company.created': ['Company created', 'admin'],
    'admin.company.updated': ['Company updated', 'admin'],
    'admin.company.deleted': ['Company deleted', 'admin'],
    'admin.user.created': ['User created', 'admin'],
    'admin.user.updated': ['User updated', 'admin'],
    'admin.user.deleted': ['User deleted', 'admin'],
    'admin.link.created': ['Sign-in link created', 'admin'],
    'admin.link.revoked': ['Sign-in link revoked', 'admin'],
  };
  const REASONS = {
    bad_credentials: 'Wrong username or password',
    paused: 'Account paused',
    expired: 'Access had ended',
    unknown_link: 'Unknown sign-in link',
    link_used: 'Link already used',
    link_expired: 'Link expired',
    link_revoked: 'Link revoked',
  };

  function fmtVal(field, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (/accessEndsAt$/.test(field) && typeof v === 'string') return fmtDate(v);
    if (field === 'apps' && Array.isArray(v)) return v.map((x) => x.name).join(', ');
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }

  function eventDetails(e) {
    if (e.type === 'embed.open') return `${esc(e.appName || '')}${e.accountType ? ` <small>as ${esc(e.accountType)}${e.preview ? ' · admin preview' : ''}</small>` : ''}`;
    if (e.type === 'signin.failed') return `${esc(REASONS[e.reason] || e.reason || '')}${e.method === 'link' ? ' <small>via sign-in link</small>' : ''}`;
    if (e.type === 'signin.success') return e.method === 'link' ? 'Sign-in link' : 'Password';
    if (e.type === 'admin.link.created' && e.details) return `${e.details.singleUse ? 'Single use' : 'Reusable'} <small>expires ${esc(fmtDateTime(e.details.expiresAt))}</small>`;
    if (e.changes && e.changes.length) {
      const shown = e.changes.slice(0, 6).map((c) => `<div class="chg">${esc(c.field)}: ${esc(fmtVal(c.field, c.from))} → ${esc(fmtVal(c.field, c.to))}</div>`).join('');
      return shown + (e.changes.length > 6 ? `<small>+${e.changes.length - 6} more</small>` : '');
    }
    if (e.type === 'admin.company.deleted' && e.details) return `${plural(e.details.users || 0, 'user')} removed`;
    return '';
  }

  function eventWho(e) {
    const actor = e.actor && e.actor.username;
    if (e.type.startsWith('admin.')) return `${esc(actor || 'admin')}${e.username ? `<small>→ ${esc(e.username)}</small>` : ''}`;
    if (e.type === 'embed.open' && e.preview) return `${esc(actor || 'admin')}<small>as ${esc(e.username)}</small>`;
    return `${esc(e.username || '—')}${e.ip ? `<small>${esc(e.ip)}</small>` : ''}`;
  }

  const searchText = (e) => [e.username, e.actor && e.actor.username, e.tenantName, e.appName, e.reason, e.ip,
    ...(e.changes || []).map((c) => c.field)].filter(Boolean).join(' ').toLowerCase();

  function renderActivity() {
    const q = $('actSearch').value.trim().toLowerCase();
    const shown = q ? actEvents.filter((e) => searchText(e).includes(q)) : actEvents;
    $('actRows').innerHTML = shown.map((e) => {
      const [label, cls] = EVENT_INFO[e.type] || [e.type, 'admin'];
      return `<tr>
        <td class="t" title="${esc(new Date(e.ts).toString())}">${esc(relTime(e.ts))}<small>${esc(fmtDateTime(e.ts))}</small></td>
        <td><span class="ev ${cls}">${esc(label)}</span></td>
        <td class="who">${eventWho(e)}</td>
        <td>${esc(e.tenantName || '—')}</td>
        <td class="det">${eventDetails(e)}</td>
      </tr>`;
    }).join('');
    $('actEmpty').hidden = shown.length > 0;
    $('actCount').textContent = `Showing ${shown.length} of ${actTotal}`;
    $('actMore').hidden = !actNext;
  }

  async function loadActivity(reset) {
    const qs = new URLSearchParams({ limit: '100' });
    if ($('actCompany').value) qs.set('tenant', $('actCompany').value);
    if ($('actType').value) qs.set('type', $('actType').value);
    if (!reset && actNext) qs.set('before', actNext);
    $('actMore').disabled = true;
    try {
      const data = await Portal.api('/api/activity?' + qs.toString());
      actEvents = reset ? data.events : actEvents.concat(data.events);
      actNext = data.next;
      if (reset) actTotal = data.total;
      renderActivity();
    } catch (err) {
      toast(err.message, true);
    } finally {
      $('actMore').disabled = false;
    }
  }

  function openActivity() {
    showView('activityView');
    history.replaceState(null, '', '#activity');
    loadActivity(true);
  }

  $('actCompany').addEventListener('change', () => loadActivity(true));
  $('actType').addEventListener('change', () => loadActivity(true));
  $('actSearch').addEventListener('input', renderActivity);
  $('actRefresh').addEventListener('click', () => loadActivity(true));
  $('actMore').addEventListener('click', () => loadActivity(false));
  $('actExport').addEventListener('click', () => {
    const cols = ['time', 'event', 'actor', 'user', 'company', 'app', 'account_type', 'method', 'reason', 'changes', 'ip'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = actEvents.map((e) => [
      e.ts, e.type, e.actor && e.actor.username, e.username, e.tenantName, e.appName, e.accountType, e.method, e.reason,
      e.changes ? e.changes.map((c) => `${c.field}: ${fmtVal(c.field, c.from)} -> ${fmtVal(c.field, c.to)}`).join('; ') : '', e.ip,
    ].map(cell).join(','));
    const blob = new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `embed-portal-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });


  // ---------- Sigma picker (read-only Sigma API) ----------
  // Browse workbooks, pages and elements instead of pasting links. Choosing
  // one fills the app row's URL and type; nothing is saved until Save.
  const picker = $('pickerDialog');
  const pick = { row: null, level: 'workbooks', wb: null, page: null, workbooks: null, pages: [], elements: [], loading: false, filtered: [] };
  const catalog = (path, fresh) => Portal.api('/api/catalog/' + path + (fresh ? '?fresh=1' : ''));

  async function pickerLoad(fn) {
    pick.loading = true;
    $('pickerError').hidden = true;
    renderPicker();
    try { await fn(); }
    catch (err) { $('pickerError').textContent = err.message; $('pickerError').hidden = false; }
    finally { pick.loading = false; renderPicker(); }
  }

  const fetchWorkbooks = (fresh) => pickerLoad(async () => {
    const data = await catalog('workbooks', fresh);
    pick.workbooks = data.workbooks;
    pick.filtered = data.filtered || [];
  });

  function openPicker(row) {
    pick.row = row;
    pick.level = 'workbooks';
    $('pickerSearch').value = '';
    picker.showModal();
    if (pick.workbooks) renderPicker(); else fetchWorkbooks();
    $('pickerSearch').focus();
  }

  function openPickWorkbook(wb) {
    pick.wb = wb;
    pick.level = 'pages';
    pick.pages = [];
    $('pickerSearch').value = '';
    pickerLoad(async () => { pick.pages = (await catalog(`workbooks/${encodeURIComponent(wb.workbookId)}/pages`)).pages; });
  }

  function openPickPage(page) {
    pick.page = page;
    pick.level = 'elements';
    pick.elements = [];
    $('pickerSearch').value = '';
    pickerLoad(async () => {
      pick.elements = (await catalog(`workbooks/${encodeURIComponent(pick.wb.workbookId)}/pages/${encodeURIComponent(page.pageId)}/elements`)).elements;
    });
  }

  function renderPicker() {
    const q = $('pickerSearch').value.trim().toLowerCase();
    const match = (...xs) => !q || xs.some((x) => String(x || '').toLowerCase().includes(q));
    const titles = { workbooks: 'Workbooks', pages: pick.wb ? pick.wb.name : '', elements: pick.page ? pick.page.name : '' };
    $('pickerTitle').textContent = titles[pick.level];
    $('pickerBack').hidden = pick.level === 'workbooks';
    $('pickerBackLabel').textContent = pick.level === 'elements' ? pick.wb.name : 'All workbooks';
    $('pickerSearch').placeholder = { workbooks: 'Search workbooks or folders', pages: 'Search pages', elements: 'Search elements' }[pick.level];
    $('pickerLoading').hidden = !pick.loading;
    $('pickerNote').textContent = pick.filtered.length
      ? `Showing workbooks in ${pick.filtered.join(', ')}. Read from the Sigma API with a view-only key.`
      : 'Read from the Sigma API with a view-only key.';
    if (pick.loading) { $('pickerList').innerHTML = ''; return; }

    const btn = (choose, label, id, name, primary) =>
      `<button class="btn${primary ? ' btn-primary' : ''}" type="button" data-choose="${choose}" data-id="${esc(id || '')}" data-name="${esc(name || '')}">${label}</button>`;
    const chev = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    let html = '';

    if (pick.level === 'workbooks') {
      const list = (pick.workbooks || []).filter((w) => match(w.name, w.path));
      html = list.slice(0, 200).map((w) => `
        <li class="pick-row-btn"><button class="pick-open" type="button" data-wb="${esc(w.workbookId)}">
          <span class="pm"><b>${esc(w.name)}</b><small>${esc(w.path || 'No folder')}${w.updatedAt ? ' · updated ' + esc(relTime(w.updatedAt)) : ''}</small></span>${chev}
        </button></li>`).join('')
        + (list.length > 200 ? `<li class="empty-row">${list.length - 200} more — refine the search.</li>` : '')
        || '<li class="empty-row">No workbooks match.</li>';
    } else if (pick.level === 'pages') {
      html = `<li class="whole"><span class="pm"><b>Whole workbook</b><small>Every page, with page navigation</small></span>
        <span class="pa">${btn('workbook', 'Use whole workbook', '', pick.wb.name, true)}</span></li>`
        + (pick.pages.filter((p) => match(p.name, p.pageId)).map((p) => `
        <li><span class="pm"><b>${esc(p.name || p.pageId)}</b><small>Page · ${esc(p.pageId)}</small></span>
          <span class="pa">
            ${btn('start', 'Open workbook here', p.pageId, pick.wb.name)}
            ${btn('page', 'Only this page', p.pageId, p.name)}
            <button class="btn btn-ghost" type="button" data-page="${esc(p.pageId)}">Elements ›</button>
          </span></li>`).join('') || '<li class="empty-row">No pages match.</li>');
    } else {
      html = pick.elements.filter((e) => match(e.name, e.type, e.elementId)).map((e) => `
        <li><span class="pm"><b>${esc(e.name || (e.type ? e.type[0].toUpperCase() + e.type.slice(1) : 'Element'))}</b><small>${esc(e.type || 'element')} · ${esc(e.elementId)}</small></span>
          <span class="pa">${btn('element', 'Only this element', e.elementId, e.name || `${pick.page.name} ${e.type || 'element'}`)}</span></li>`).join('')
        || '<li class="empty-row">No elements match.</li>';
    }
    $('pickerList').innerHTML = html;
  }

  function choosePick(kind, id, name) {
    const base = pick.wb.url.replace(/[?#].*$/, '').replace(/\/+$/, '');
    const url = kind === 'start' ? `${base}?:nodeId=${id}`
      : kind === 'page' ? `${base}/page/${id}`
        : kind === 'element' ? `${base}/element/${id}`
          : base;
    const row = pick.row;
    row.querySelector('[data-f="url"]').value = url;
    row.querySelector('[data-f="mode"]').value = kind === 'page' || kind === 'element' ? kind : 'workbook';
    const nameInput = row.querySelector('[data-f="name"]');
    if (!nameInput.value.trim()) nameInput.value = name;
    picker.close();
    syncApps();
    syncUi();
  }

  $('pickerList').addEventListener('click', (e) => {
    const wb = e.target.closest('[data-wb]');
    if (wb) return openPickWorkbook(pick.workbooks.find((w) => w.workbookId === wb.dataset.wb));
    const page = e.target.closest('[data-page]');
    if (page) return openPickPage(pick.pages.find((p) => p.pageId === page.dataset.page));
    const c = e.target.closest('[data-choose]');
    if (c) choosePick(c.dataset.choose, c.dataset.id, c.dataset.name);
  });
  $('pickerSearch').addEventListener('input', renderPicker);
  $('pickerBack').addEventListener('click', () => {
    pick.level = pick.level === 'elements' ? 'pages' : 'workbooks';
    $('pickerSearch').value = '';
    renderPicker();
  });
  $('pickerRefresh').addEventListener('click', () => {
    if (pick.level === 'workbooks') fetchWorkbooks(true);
    else if (pick.level === 'pages') openPickWorkbook(pick.wb);
    else openPickPage(pick.page);
  });

  // Team suggestions. Private teams are hidden from a non-admin key, so this
  // only suggests; the comma-separated field stays the source of truth.
  $('teamAdd').addEventListener('change', () => {
    const v = $('teamAdd').value.trim();
    $('teamAdd').value = '';
    if (!v) return;
    const list = $('teams').value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!list.includes(v)) list.push(v);
    $('teams').value = list.join(', ');
    syncUi();
  });

  async function initCatalog() {
    try {
      const { teams } = await catalog('teams');
      catalogOn = true;
      $('teamOptions').innerHTML = teams.map((t) => `<option value="${esc(t)}">`).join('');
      $('teamAdd').hidden = false;
      $('teamsHint').textContent = 'Comma-separated. Each team must exist in Sigma and be shared on the workbook. Private teams don’t appear in the suggestions; type them directly.';
      document.querySelectorAll('[data-browse]').forEach((b) => { b.hidden = false; });
    } catch {
      catalogOn = false; // not configured or unreachable: keep the free-text fields
    }
  }

  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Boot ----------
  (async function init() {
    try {
      tenants = (await Portal.api('/api/tenants')).tenants;
    } catch (err) {
      $('listSpinner').hidden = true;
      $('emptyTitle').textContent = 'Couldn’t load companies';
      $('emptyTitle').hidden = false;
      $('emptyBody').textContent = err.message;
      $('emptyBody').hidden = false;
      return;
    }
    renderList();
    initCatalog();

    const [view, ...rest] = location.hash.slice(1).split('/');
    const [id, userId, appId] = rest.map((x) => decodeURIComponent(x || ''));
    if (view === 'activity') {
      if (tenants.length) { selectedId = tenants[0].id; }
      return openActivity();
    }
    if (view === 'new') return startCreate();
    if (!tenants.length) return showEmpty();
    // An explicit link (#edit/<id>) opens that company; otherwise start on
    // the first company that isn't in a collapsed group.
    const fallback = firstVisible();
    if (!tenants.some((t) => t.id === id) && !fallback) return showAllCollapsed();
    const target = tenants.some((t) => t.id === id) ? id : fallback.id;
    if (view === 'embed' && id === target) return openEmbed(target, userId, appId);
    if (view === 'dev' && id === target) return openDev(target, userId, appId);
    selectTenant(target);
  })();
})();
