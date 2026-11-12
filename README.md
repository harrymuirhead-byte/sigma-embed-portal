# Sigma embed portal

Generic, multi-company Sigma embed portal. One sign-in page; each user's
credentials route to their company's secure (JWT) Sigma embed. A company can
have many users, each with their own embed identity, account type and
user attributes. An admin sign-in opens a
console listing every company, where access levels and embed settings are set
and any embed can be opened.

Each person runs their own copy on their own Netlify, with their own Sigma
embed credentials. No companies, users or keys ship with the code — all of
that lives in your site's Netlify Blobs.

## Set up your own portal (≈5 minutes)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/harrymuirhead-byte/sigma-embed-portal)

1. **Create embed credentials in Sigma.** Administration → Developer access →
   Create new → *Embedding*. Pick an owner, then copy the **Client ID** and
   **Secret** (the secret is shown once).
2. **Click Deploy to Netlify** above. Netlify copies this repo to your GitHub
   and asks for:

   | Field | What to enter |
   |---|---|
   | `CLIENT_ID` | The embed Client ID from step 1 |
   | `EMBED_SECRET` | The embed secret from step 1 |
   | `SIGMA_ORG` | Your org slug — the first path segment of a workbook URL, e.g. `my-org` in `https://app.sigmacomputing.com/my-org/workbook/…` or `https://staging.sigmacomputing.io/my-org/workbook/…` |
   | `ADMIN_USERNAME` | Your admin console username, e.g. `admin` |
   | `ADMIN_PASSWORD` | Your admin console password (12+ characters) |

3. **Sign in** at your new site's URL with the admin username and password.
   Add a company, give it a user (username, password, embed email), add an app
   (paste a Sigma workbook, page or element URL), then open it.
4. **Share the workbook with the company's team in Sigma.** The embed user
   only sees what its team can see.

To change a value later: Netlify → Project configuration → Environment
variables, then **Deploys → Trigger deploy**. Functions only read env vars at
deploy time.

### Optional settings

| Variable | Purpose |
|---|---|
| `SIGMA_APP_HOST` | Comma-separated Sigma app hosts that workbook URLs may use. Default: `app.sigmacomputing.com,staging.sigmacomputing.io`. Set it to pin one host, or to add another |
| `SIGMA_API_CLIENT_ID` / `SIGMA_API_CLIENT_SECRET` | Turns on **Browse Sigma** pickers. Use an API (not embed) credential owned by a View-only user |
| `SIGMA_API_BASE` | Sigma REST API base for your cloud, default `https://api.sigmacomputing.com` |
| `PICKER_FOLDERS` | Comma-separated folder paths to narrow the workbook picker |
| `SESSION_SECRET` | 32+ characters to sign portal sessions. If unset it's derived from `EMBED_SECRET` (rotating that then signs everyone out) |
| `ADMIN_PASSWORD_HASH` | Use instead of `ADMIN_PASSWORD` to store only a hash: `node scripts/hash-password.mjs '<password>'` |

### Troubleshooting

- **"Invalid kid parameter"** — `CLIENT_ID` isn't an active *embed* Client ID
  in the org your workbook URLs point at (an API client ID won't work, nor
  one that was deleted or rotated). Fix the value and redeploy.
- **"Workbook URL must belong to the … org"** — `SIGMA_ORG` doesn't match
  the URL you pasted. It takes a comma-separated list if you need more than one.
- **Staging (`staging.sigmacomputing.io`)** — staging URLs are accepted out of
  the box, but the embed credentials must be created in that staging org.
  Production credentials won't sign staging embeds, and vice versa.
- **"Admin password is not configured"** — `ADMIN_PASSWORD` is missing or
  under 12 characters.
- **Embed loads but says no access** — share the workbook with the team set
  on the company, or check the embed email isn't an existing non-embed user.

### Deploy with the CLI instead

```
npm i -g netlify-cli
git clone https://github.com/harrymuirhead-byte/sigma-embed-portal && cd sigma-embed-portal
npm install
netlify login && netlify init
netlify env:set CLIENT_ID <client-id>
netlify env:set EMBED_SECRET <secret>
netlify env:set SIGMA_ORG <org-slug>
netlify env:set ADMIN_USERNAME admin
netlify env:set ADMIN_PASSWORD '<password>'
netlify deploy --prod
```

Run locally with `netlify dev --port 8888` (uses a local Blobs sandbox).

## How permissions work

| Admin setting | Sent to Sigma |
|---|---|
| View only / Explore / Build | JWT `account_type` = Viewer / Explorer / Creator |
| Custom | JWT `account_type` = any account type name in the org |
| User access level | Per user; "Company default" inherits the company level |
| Embed user email | JWT `sub` — unique per user across the portal |
| Teams | JWT `teams` (company-wide) |
| User attributes | JWT `user_attributes` — company values merged with the user's (user wins). Attributes must exist in Sigma or the sign-in is refused |
| Interface switches | `:show_assistant`, `:hide_save_as`, `:hide_send`, … URL params |

Settings live in Netlify Blobs (strong consistency) and are read on every
signing, so a change applies at the company's next sign-in (or the portal's
next token refresh). Sigma updates an existing embed user's account type and
teams whenever the JWT claims change.

Effective rights are capped by the team's grant on the workbook: Build needs
Creator *and* the team shared on the workbook (Can edit to edit the original;
Save As works with Can view/explore).

## Features

- **App catalog** — each company has an ordered list of apps (whole workbook,
  single page `/page/<id>` or single element `/element/<id>`), shown to users
  in a collapsible launcher (hidden when there's only one app).
- **Developer view** (admin) — the live signed URL taken apart, the decoded
  JWT with every claim explained, and matching server code for Node.js
  (jsonwebtoken), Python (PyJWT) and Java (jjwt), plus a frontend snippet.
- **Activity log** (admin → Activity) — sign-ins (password or link, and
  failures with reasons), app opens, and every admin change as a field-level
  diff. One blob per event in the `embed-portal-activity` store, 90-day
  retention, CSV export.
- **Time-boxed access** — optional end date on a company and/or user (the
  earlier wins; sessions and JWTs are capped to it). Sign-in links: expiring,
  optionally single-use, revocable; users can be links-only (no password).
  Only a SHA-256 of each link token is stored.
- **Sigma pickers** (admin) — "Browse Sigma" on each app lists workbooks →
  pages → elements from the Sigma REST API; team suggestions under the teams
  field. Four fixed GET calls only (netlify/lib/sigma-api.mjs). Private teams
  and user attributes aren't visible to that key, so those stay free text.

## Layout

```
public/            index.html (sign-in + #link= sign-in links), portal.html (launcher + embed), admin.html (console)
public/js          admin.js, devview.js (URL/JWT analysis + code samples), embed.js, icons.js, session.js
netlify/functions  login, link-login, session, embed-url, tenants (admin CRUD + users + links), activity, catalog (Sigma pick lists)
netlify/lib        auth (scrypt + HMAC sessions), sigma (URL parsing + JWT), tenants (store, apps, access windows, links), activity
```
