// Developer view helpers: take a live signed embed URL apart, explain each
// piece, and generate server code (Node, Python, Java) that produces the same
// URL. Pure functions; the admin console does the rendering.
window.DevView = (function () {
  const PARAM_DOCS = {
    ':jwt': 'The signed JWT below. Sigma checks its signature against your embed secret, then signs the user in.',
    ':embed': 'Required. Tells Sigma this is a secure embed.',
    ':nodeId': 'Opens the workbook on this page.',
    ':menu_position': 'Toolbar position: top, bottom or none (removes it).',
    ':show_assistant': 'Shows the Ask Sigma assistant.',
    ':hide_folder_navigation': 'Hides folder navigation.',
    ':hide_save_as': 'Hides the Save As button.',
    ':hide_explore_toggle': 'Hides the explore toggle.',
    ':hide_send': 'Hides download and export options.',
    ':hide_schedule': 'Hides scheduled exports.',
    ':hide_bookmarks': 'Hides saved views.',
    ':hide_element_interactions': 'Hides the element toolbar (filters, More menu).',
    ':hide_tooltip': 'Hides chart tooltips.',
    ':theme': 'Applies a workbook theme by name (case sensitive).',
    ':lng': 'Sets the UI language and number and date formats.',
  };

  const CLAIM_DOCS = {
    sub: 'The embed user’s identity. Sigma creates this embed user on first sign-in and updates it on every later one.',
    iss: 'Your embed client ID.',
    jti: 'A unique id for this token, so it can’t be replayed.',
    iat: 'Issued at, in Unix seconds.',
    exp: 'Expiry, in Unix seconds. At most 30 days after iat.',
    ver: 'Claims version. 1.1 requires aud.',
    aud: 'Must be "sigmacomputing" when ver is 1.1.',
    account_type: 'The Sigma account type, which decides what the user can do (view, explore, build). Changing it changes the user on their next sign-in.',
    teams: 'Sigma teams for the user. Replaces their team membership on every sign-in; a team needs access to the workbook.',
    first_name: 'Display name shown in Sigma.',
    last_name: 'Display name shown in Sigma.',
    user_attributes: 'Values for Sigma user attributes, used for row-level security. Each attribute must exist in Sigma.',
    kid: 'Your embed client ID, so Sigma knows which secret to verify with.',
    alg: 'Must be HS256.',
    typ: 'Always JWT.',
  };

  const MODE_DOCS = {
    workbook: 'The workbook to render. The whole workbook, with page navigation.',
    page: 'A single workbook page (…/page/<pageId>), without the rest of the workbook.',
    element: 'A single element (…/element/<elementId>), such as one chart or table.',
  };

  function decodePart(part) {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function analyse(url) {
    const q = url.indexOf('?');
    const base = url.slice(0, q);
    const parts = url.slice(q + 1).split('&');
    const jwt = parts.find((p) => p.startsWith(':jwt=')).slice(5);
    const params = parts.filter((p) => !p.startsWith(':jwt='));
    const segments = jwt.split('.');
    return { base, params, jwt, segments, header: decodePart(segments[0]), payload: decodePart(segments[1]) };
  }

  // Claims that depend on the user (everything except the per-token fields).
  const DYNAMIC = new Set(['iss', 'jti', 'iat', 'exp', 'ver', 'aud']);
  const userClaims = (payload) => Object.entries(payload).filter(([k]) => !DYNAMIC.has(k));

  const lit = (v) => JSON.stringify(v);
  const jsKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : lit(k));

  function node(a) {
    const ttl = a.payload.exp - a.payload.iat;
    const claims = userClaims(a.payload).map(([k, v]) => `      ${jsKey(k)}: ${lit(v)},`).join('\n');
    return {
      dep: 'npm install jsonwebtoken',
      code: `const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const CLIENT_ID = process.env.SIGMA_CLIENT_ID;
const EMBED_SECRET = process.env.SIGMA_EMBED_SECRET;

const EMBED_BASE = ${lit(a.base)};
const PARAMS = [
${a.params.map((p) => `  ${lit(p)},`).join('\n')}
];

// Call from an authenticated route (e.g. GET /api/sigma-embed-url) and
// return { url, expiresIn } to the browser. Never expose EMBED_SECRET.
function signedEmbedUrl() {
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iss: CLIENT_ID,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + ${ttl},
      ver: '1.1',
      aud: 'sigmacomputing',
      // Per-user values: take these from your signed-in user.
${claims}
    },
    EMBED_SECRET,
    { algorithm: 'HS256', keyid: CLIENT_ID },
  );
  return { url: \`\${EMBED_BASE}?:jwt=\${token}&\${PARAMS.join('&')}\`, expiresIn: ${ttl} };
}

module.exports = { signedEmbedUrl };
`,
    };
  }

  function python(a) {
    const ttl = a.payload.exp - a.payload.iat;
    const claims = userClaims(a.payload).map(([k, v]) => `        ${lit(k)}: ${lit(v)},`).join('\n');
    return {
      dep: 'pip install PyJWT',
      code: `import os
import time
import uuid

import jwt  # PyJWT

CLIENT_ID = os.environ["SIGMA_CLIENT_ID"]
EMBED_SECRET = os.environ["SIGMA_EMBED_SECRET"]

EMBED_BASE = ${lit(a.base)}
PARAMS = [
${a.params.map((p) => `    ${lit(p)},`).join('\n')}
]


def signed_embed_url() -> dict:
    """Call from an authenticated route and return the result to the browser.
    Never expose EMBED_SECRET."""
    now = int(time.time())
    claims = {
        "iss": CLIENT_ID,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + ${ttl},
        "ver": "1.1",
        "aud": "sigmacomputing",
        # Per-user values: take these from your signed-in user.
${claims}
    }
    token = jwt.encode(claims, EMBED_SECRET, algorithm="HS256", headers={"kid": CLIENT_ID})
    return {"url": f"{EMBED_BASE}?:jwt={token}&" + "&".join(PARAMS), "expiresIn": ${ttl}}
`,
    };
  }

  function javaValue(v) {
    if (Array.isArray(v)) return `List.of(${v.map(lit).join(', ')})`;
    if (v && typeof v === 'object') {
      const entries = Object.entries(v);
      return entries.length <= 10
        ? `Map.of(${entries.map(([k, x]) => `${lit(k)}, ${lit(x)}`).join(', ')})`
        : `Map.ofEntries(${entries.map(([k, x]) => `Map.entry(${lit(k)}, ${lit(x)})`).join(', ')})`;
    }
    return lit(v);
  }

  function java(a) {
    const ttl = a.payload.exp - a.payload.iat;
    const claims = userClaims(a.payload).map(([k, v]) => (k === 'sub'
      ? `                .subject(${lit(v)})`
      : `                .claim(${lit(k)}, ${javaValue(v)})`)).join('\n');
    return {
      dep: 'Maven: io.jsonwebtoken:jjwt-api, jjwt-impl and jjwt-jackson (0.12.x)',
      code: `import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class SigmaEmbed {
    private static final String CLIENT_ID = System.getenv("SIGMA_CLIENT_ID");
    private static final String EMBED_SECRET = System.getenv("SIGMA_EMBED_SECRET");

    private static final String EMBED_BASE = ${lit(a.base)};
    private static final List<String> PARAMS = List.of(
${a.params.map((p) => `        ${lit(p)}`).join(',\n')}
    );

    // Call from an authenticated endpoint and return the URL to the browser.
    // Never expose EMBED_SECRET.
    public static String signedEmbedUrl() {
        Instant now = Instant.now();
        String token = Jwts.builder()
                .header().keyId(CLIENT_ID).and()
                .issuer(CLIENT_ID)
                .id(UUID.randomUUID().toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(${ttl})))
                .audience().single("sigmacomputing") // Sigma expects a string, not an array
                .claim("ver", "1.1")
        // Per-user values: take these from your signed-in user.
${claims}
                .signWith(Keys.hmacShaKeyFor(EMBED_SECRET.getBytes(StandardCharsets.UTF_8)), Jwts.SIG.HS256)
                .compact();
        return EMBED_BASE + "?:jwt=" + token + "&" + String.join("&", PARAMS);
    }
}
`,
    };
  }

  function frontend(a) {
    const ttl = a.payload.exp - a.payload.iat;
    return `<iframe id="sigma" title="Analytics" allowfullscreen
        style="width: 100%; height: 100vh; border: 0"></iframe>

<script>
  // /api/sigma-embed-url runs the server code above for the signed-in user
  // and returns { url, expiresIn } (${ttl} seconds here).
  async function loadSigma() {
    const res = await fetch('/api/sigma-embed-url', { credentials: 'include' });
    const { url, expiresIn } = await res.json();
    document.getElementById('sigma').src = url;
    // Re-sign at 80% of the token's lifetime.
    setTimeout(loadSigma, expiresIn * 800);
  }
  loadSigma();
</script>
`;
  }

  return { analyse, code: { node, python, java }, frontend, PARAM_DOCS, CLAIM_DOCS, MODE_DOCS };
})();
