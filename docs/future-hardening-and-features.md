# Hardening

Extra protection the template leaves out, safe to ship without, but worth deciding on per project. None of these is a
bug in the code as it runs today. Each one starts to matter only under a condition named below: a server set up a
certain way, a CDN in front, a domain shared with other sites, or accounts worth breaking into. Go through the list
before going live ([deployment.md](./deployment.md) → Before Going Live) and either fix an item or note why it doesn't
apply.

## Rate Limits Can Count Many Visitors as One

The app limits requests per visitor address, which Caddy passes in `X-Real-IP` from the connection it sees
(`{remote_host}` in `deploy/Caddyfile`, `clientAddress` in `src/lib/rate-limit.server.ts`). Two setups break the
"one address is one visitor" assumption:

- **IPv6 through Docker's port proxy.** When the server has a public IPv6 address (and the domain an `AAAA` record) but
  the Compose network has no IPv6, Docker's userland proxy accepts the IPv6 connection and opens a new IPv4 one to
  Caddy. Caddy then sees the network's gateway address for every IPv6 visitor, so they all share one bucket: ten
  sign-ins a minute for all of them together (`CREDENTIAL_RATE_LIMIT` in `src/routes/api_auth/api-auth.ts`).
- **A CDN or another proxy in front of Caddy** (ArvanCloud, Cloudflare, a load balancer). Every request then comes from
  the CDN's few addresses, with the same result for everyone.

The opposite case, one person rotating through the many addresses of their IPv6 `/64`, is already covered: the limiter
counts a `/64` as one client (`addressKey`).

**When it matters:** as soon as the setup applies.

**How to check:**

- IPv6: `dig AAAA <DOMAIN>` returns an address, and `docker network inspect <project>_default` shows
  `"EnableIPv6": false`. To see it happen, sign in over IPv6 more than ten times in a minute while someone else signs
  in over IPv4: if only the IPv6 attempts are refused, the limit is shared.
- CDN: the domain's DNS points at the CDN rather than at the server.

**How to fix:**

- IPv6: give the Compose network IPv6 (`enable_ipv6: true` on the default network in `compose.prod.yaml`, with IPv6
  turned on in Docker's daemon), so Caddy sees the real address. Or remove the `AAAA` record until then.
- CDN: tell Caddy which addresses are the CDN's and which header carries the visitor's address, then pass that on.
  In the Caddyfile's global options,
  `servers { trusted_proxies static <CDN ranges> client_ip_headers X-Forwarded-For }`, and
  `header_up X-Real-IP {client_ip}` in place of `{remote_host}`. Only list the CDN's own ranges: anyone else could then
  pick their address.

## Sign-in Attempts Are Limited per Address, Not per Account

Sign-in allows ten attempts a minute from one address (`CREDENTIAL_RATE_LIMIT` in
`src/routes/api_auth/api-auth.ts`), and nothing counts the attempts made on one account. Someone guessing an account's
password from many addresses at once (a botnet, a list of proxies) is slowed on each address but never on the account,
and Better-Auth's sign-in has no lockout of its own. The app's other protections don't cover this: the captcha guards
sign-up only, and a password needs eight characters, with no check that it isn't a known leaked one.

**When it matters:** once an account holds something worth the effort (money, personal data, an admin role), or as
soon as a review asks for a lockout.

**How to check:** the app's log has a line per request at `LOG_LEVEL=info`: many `POST /api/auth/sign-in/email 401`
within minutes, more than the people who use the site could mistype.

**How to fix:** pick what fits the project; the first two together cover most of it.

- Count sign-ins per account as well: a second policy beside `rejectOverLimit`'s, keyed by the email in the request
  body rather than the client's address, low enough to stop guessing and high enough for someone who forgot their
  password (say ten an hour). A limit that refuses outright lets anyone lock a person out by failing on purpose, so
  prefer one that asks for the captcha once it is reached.
- Refuse leaked passwords at sign-up and reset with Better-Auth's `haveibeenpwned` plugin. It sends the first five
  characters of the password's SHA-1 hash to `api.pwnedpasswords.com`, so check the server can reach it.
- Add a second factor for the roles that matter (Better-Auth's `two-factor` plugin).

## No Content-Security-Policy

Caddy sets the other security headers, but no page has a CSP, so a script injected into a page (through a future XSS
bug) would run with nothing to stop it. React escapes what it renders, so this is defense in depth, not an open hole.

**When it matters:** once a page renders HTML it didn't write (`dangerouslySetInnerHTML`, a rich-text editor, a
third-party widget), or as soon as a review or customer asks for one.

**How to fix:** send a policy from the app, which knows its inline scripts:

- `script-src 'self' 'nonce-…'`, with a fresh nonce per request on the inline theme script (`THEME_INIT_SCRIPT` in
  `src/routes/__root.tsx`) and on the scripts TanStack Start writes for hydration. The router accepts a nonce for its
  own scripts; check the installed version's docs for the option.
- `connect-src 'self' https://<ERRORS_DOMAIN>`, or browser errors can't be reported (`src/client.tsx`).
- `img-src 'self' data:`: image placeholders are `data:` URIs (`media.placeholder`). In development, also
  `MEDIA_PUBLIC_URL`'s origin, since images load straight from SeaweedFS there.
- `frame-ancestors 'none'`, matching Caddy's `X-Frame-Options: DENY`.

Start with `Content-Security-Policy-Report-Only` and fix what the browser console reports before enforcing it.
