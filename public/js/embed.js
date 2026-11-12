// Loads a signed Sigma embed into an iframe and re-signs it before the JWT
// expires. Settings are read server-side on every signing, so a refresh also
// picks up any permission change the admin has saved since.
window.EmbedFrame = function ({ iframe, loading, error, errorMessage, onSigned, query }) {
  let timer = null;
  let current = null;
  let seq = 0;

  function show(state) {
    loading.hidden = state !== 'loading';
    error.hidden = state !== 'error';
    iframe.style.visibility = state === 'ready' ? 'visible' : 'hidden';
  }

  // `refresh` marks a timed re-sign, so the activity log doesn't count it as
  // a new visit.
  async function load(tenantId, { refresh = false } = {}) {
    if (tenantId !== undefined) current = tenantId;
    const mine = ++seq;
    clearTimeout(timer);
    show('loading');
    try {
      const params = new URLSearchParams({
        ...(current ? { tenant: current } : {}),
        ...(query ? query() : {}),
        ...(refresh ? { purpose: 'refresh' } : {}),
      });
      const qs = params.toString();
      const data = await Portal.api('/api/embed-url' + (qs ? '?' + qs : ''));
      if (mine !== seq) return; // a newer load superseded this one
      iframe.onload = () => { if (mine === seq) show('ready'); };
      iframe.src = data.url;
      if (onSigned) onSigned(data);
      timer = setTimeout(() => load(undefined, { refresh: true }), (data.expiresIn || 3600) * 0.8 * 1000);
    } catch (err) {
      if (mine !== seq) return;
      errorMessage.textContent = err.message || 'Unable to load the embed.';
      show('error');
    }
  }

  function stop() {
    seq++;
    clearTimeout(timer);
    iframe.removeAttribute('src');
  }

  return { load, stop };
};
