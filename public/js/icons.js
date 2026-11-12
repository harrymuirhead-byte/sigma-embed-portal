// App icons shared by the portal launcher and the admin console. Keys match
// APP_ICONS on the server.
window.AppIcons = (function () {
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    dashboard: { label: 'Dashboard', svg: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>') },
    chart:     { label: 'Bar chart', svg: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>') },
    trend:     { label: 'Trend', svg: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>') },
    table:     { label: 'Table', svg: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>') },
    map:       { label: 'Map', svg: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>') },
    ai:        { label: 'AI', svg: svg('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>') },
    report:    { label: 'Report', svg: svg('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>') },
    people:    { label: 'People', svg: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>') },
    money:     { label: 'Finance', svg: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.1 0 2.9 6 1.4 6 4.3 0 1.2-1.3 2.1-3 2.1-1.4 0-2.6-.6-3-1.6M12 6.5v11"/>') },
    box:       { label: 'Operations', svg: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>') },
  };
  return {
    keys: Object.keys(ICONS),
    label: (k) => (ICONS[k] || ICONS.dashboard).label,
    svg: (k) => (ICONS[k] || ICONS.dashboard).svg,
  };
})();
