# Security audit and production-readiness plan

A plan, not a record of finished work. "Today" says what the code does as of this writing. The automated attack script (`scripts/security-check.mjs`) only tests what we already thought of; this is meant to find the rest and close it.

## 1. Where things stand

| Area | Today | Gap | Priority | Size |
|---|---|---|---|---|
| **Password storage** | scrypt, per-password salt | Cost is modest (N=16384) | Medium | S |
| **Sessions** | 256-bit bearer token, only a hash stored, 30 days, password change signs out others | No idle timeout, no "your devices" list | Medium | M |
| **Roles and permissions** | Checks in each route (`memberAccess`, `ownedInstitution`), default-deny by 404 | A new route can forget its check. See section 3 | **High** | M |
| **Rate limiting** | In memory, per process | Resets on restart, can't work across several servers, sign-up flood locks everyone out (lead 1) | **High** | M |
| **Input validation** | Hand-written per route | `PUT profile` stores nearly any JSON up to 5 MB. No shared schema | **High** | L |
| **HTTP status codes** | Consistent 400/401/403/404/409/410/429 | Not documented or contract-tested. 404-for-forbidden is deliberate | Low | S |
| **Pagination** | None. Lists have hard caps (2,000 events, 20,000 scans) or are unbounded (attendance, students, timetables) | Records past a cap silently vanish; `/auth/me` grows with every register | **High** | M |
| **DB indexing** | Key lookups indexed | Events are fetched then filtered in JS by date and kind. `data` JSONB has no expression indexes. Never load-tested | Medium | M |
| **Caching** | Static assets cached forever by hash | No caching of timetable or roster; `/auth/me` reloads everything | Medium | M |
| **CDN** | None | Static files come from nginx on one box. Low value on a tailnet; worthwhile once public | Low now | S |
| **Load balancing** | One API container | Blocked by in-memory limiters. Then two API replicas behind nginx | Medium | M |
| **Monitoring** | Docker health checks only | No metrics, uptime alerts, or disk or backup alerts | **High** | M |
| **Error tracking** | `console.error` to container logs | Nobody is told. Nothing from phones | **High** | S |
| **Audit logging** | Student marks keep who and when. Nothing else does | Admin actions, attendance edits, logins, key creation, exports aren't recorded | **High** | M |
| **Automated testing** | Unit, integration on real Postgres, white-box, browser e2e, attack script, coverage floor | Run by hand. No CI on GitHub. Permission matrix missing | **High** | M |
| **CI/CD pipeline** | `deploy.sh` run by hand, no workflows | No required checks before merge | **High** | M |
| **Staging environment** | None; the demo is production | Risky tests have nowhere safe to run | **High** | S |
| **Encryption in transit** | Plain HTTP over Tailscale. HTTPS profile exists but isn't on | Required before any public use | **Critical before launch** | S |
| **Encryption at rest** | Backups and DB unencrypted, on the same host as other projects | Encrypt backups and copy them off the box. Secrets are a plain `.env` | **High** | M |
| **Semantic versioning** | API 0.1.0, app 1.0.0, never bumped | No tags, changelog, or API compatibility rule for old APKs | Medium | S |
| **Feature flags** | Only env switches (`ALLOW_SIGNUP`, `ALLOW_DEMO`) | No per-college rollout | Medium | M |
| **SSRF** | Three outbound calls (LLM, solver, WhatsApp), all to configured addresses. No user-supplied URLs | The app's "change server" is client-side only. Keep it this way; webhooks would need an allow-list and private-range blocking | Low; review | S |
| **CORS** | Same-origin in Docker (empty list). Any origin when unset in development | Fail closed if `NODE_ENV=production` and unset | Medium | S |
| **CSRF** | Bearer tokens in a header, not cookies, so forms from other sites can't use them | Stays safe only while we avoid cookies. Moving to cookies needs SameSite plus tokens | Low; keep watching | S |
| **XSS and token theft** | CSP blocks inline scripts; print pages escape | Web token is in `localStorage`, so one XSS means stolen session | Medium | M |
| **Magic links** | Not built. One-use hashed invites are a ready pattern | Needs an email provider, 15-minute expiry, one use, no account-enumeration | Medium | M |
| **Passkeys** | Not built | WebAuthn needs HTTPS and a stable domain, so it follows the domain. Native needs extra work | Medium, after HTTPS | L |
| **2FA for admins** | None, including central admin | Central admin can reach every college | **High** | M |
| **Data rights (DPDP)** | Whole-college delete only | No per-student erasure, retention rules or consent record | **High** | M |

## 2. Known leads to confirm or fix first

1. A sign-up flood blocks every sign-up and invite join for an hour (shared IP behind Docker).
2. Any teacher can list the whole college's scan times.
3. The connector's machine allow-list trusts a serial number sent in plain text.
4. The APK allows unencrypted traffic.
5. QR cards and phone check-in can be shared or used from outside the room. Teachers confirming the register is the control.
6. Jenkins and other projects share the server, and may have Docker access.
7. Spreadsheet exports may allow formula injection.
8. The "change server" option could be used to point someone at a fake server.
9. npm reported known vulnerabilities during install.
10. Heavy imports and the date-reading patterns could tie up the server.
11. Phone check-in depends on `TRUST_PROXY` matching the real number of proxies. With the wrong value, every student has the same address, or the address can be forged. Add a start-up check.

## 3. Complete authentication and authorization pipeline

**Every request passes the same steps, in order:**

1. **Edge:** HTTPS only, HSTS, body-size limit, global rate limit.
2. **Identify:** one middleware recognises each credential: staff session, `tfd_` device key, `tfs_` student phone, Meta signature. Each type is accepted only on its own routes.
3. **Authenticate:** token hash found, unexpired, account and college active.
4. **Authorize:** one central policy (`can(actor, action, resource)`) replaces the per-route checks.
5. **Validate:** a schema for each route's body, query and parameters. Unknown fields rejected.
6. **Scope:** every query is filtered by college id; the repository layer requires it.
7. **Act,** with limits per actor.
8. **Audit:** who, what, which record, from where, outcome, append-only.
9. **Respond:** only fields on the allow-list for that role.

**The safeguard that makes "nothing missed" real:** a table of every route with who may call it, and a test that fails when a route exists without an entry. It tries each route with: no credential, teacher, admin, another college's admin, central admin, each key type, student phone, expired token, removed member, paused college.

**Sign-in options, in order:** password plus admin 2FA, then email magic links, then passkeys. Account recovery, session list with "sign out this device", and step-up re-entry for dangerous actions (delete, rotate cards, new keys).

## 4. Audit phases

| Phase | Work | Days |
|---|---|---|
| 1. Map | Endpoints, roles, data, trust boundaries, threat model | 0.5 |
| 2. Automated scans in Docker | `npm audit`, `pip-audit`, Semgrep, gitleaks over history, Trivy, OWASP ZAP baseline | 0.5 |
| 3. Permission matrix | The test described in section 3 | 1 |
| 4. Manual review | Auth, invites, keys, check-in, imports, WhatsApp signature, assistant actions, queries | 1–2 |
| 5. Abuse and load | Floods, huge uploads, slow patterns, races, replay, proxy attendance, `k6` load test | 1 |
| 6. Phone app | Decompile, token storage, secrets, cleartext (MobSF) | 0.5 |
| 7. Server | Ports, container privileges, `.env` and backup permissions, reach of other projects | 0.5 |
| 8. Report and fix | Severity, reproduction, fix test-first, add to attack script | varies |

## 5. Suggested order of work

Sizes: S is under a day, M is 1–3 days, L is about a week.

1. **Foundations (week 1):** staging copy, GitHub Actions running every suite with required checks, HTTPS, error tracking, uptime and backup alerts, semantic versioning.
2. **Run the audit (week 2)** on staging, and fix critical and high findings.
3. **Auth pipeline (weeks 3–4):** central policy, route table test, schema validation, audit log, admin 2FA, session management, Postgres-backed rate limits with per-account keys.
4. **Scale (week 5):** pagination, query and index work guided by the load test, caching, second API replica, encrypted off-site backups.
5. **Product (week 6 onward):** feature flags, per-student erasure and retention, magic links, passkeys, CDN when public.

## 6. Ground rules

- Destructive and flood tests run on staging, never the live demo.
- Throwaway test colleges only; no real student data.
- Stay inside the TimeFlex project on atreya-2.

## Decisions needed

1. A staging copy on atreya-2, or a separate machine?
2. May the scanners run in Docker on atreya-2?
3. Which domain will this live on? HTTPS, passkeys and magic links all depend on it.
4. Which email provider for magic links, and which error tracker (self-hosted GlitchTip fits the Docker approach)?
