// Shared session helpers. The token lives in sessionStorage, so closing the
// tab signs the user out; every API call re-checks it server-side.
window.Portal = (function () {
  const KEY = 'sigma_portal_session';

  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!s || !s.token || s.expiresAt * 1000 < Date.now()) return null;
      return s;
    } catch {
      return null;
    }
  }

  function setSession(data) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        token: data.token, expiresAt: data.expiresAt, role: data.role, username: data.username,
      }));
    } catch { /* storage blocked: the next page will bounce back to sign-in */ }
  }

  function signOut() {
    try { sessionStorage.removeItem(KEY); } catch {}
    location.replace('/');
  }

  // Redirects to sign-in when there's no session or the role doesn't match.
  function require(role) {
    const s = getSession();
    if (!s) { location.replace('/'); return null; }
    if (role && s.role !== role) { location.replace(s.role === 'admin' ? '/admin' : '/portal'); return null; }
    return s;
  }

  async function api(path, options = {}) {
    const s = getSession();
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(s ? { Authorization: 'Bearer ' + s.token } : {}),
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) { signOut(); throw new Error('Your session has expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  }

  return { getSession, setSession, signOut, require, api };
})();
