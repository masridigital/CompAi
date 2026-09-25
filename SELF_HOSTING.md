## Self-hosting Comp (Apps + Portal)

This file is a brief overview for Docker-based self-hosting.

**For the detailed, up-to-date guide, see:**

- [Docker Self-Hosting Guide](https://trycomp.ai/docs/self-hosting/docker)
- [Environment Reference](https://trycomp.ai/docs/self-hosting/env-reference)

### Quick Summary

Docker uses **separate env files** (not a root `.env`):

| File | Services |
|------|----------|
| `packages/db/.env` | migrator, seeder |
| `apps/app/.env` | app |
| `apps/portal/.env` | portal |

### Minimal Required Environment

For a functional deployment:

- **Database**: `DATABASE_URL` in all three env files
- **Auth**: `AUTH_SECRET`, `SECRET_KEY`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` (app); `BETTER_AUTH_SECRET` (portal)
- **Email**: configured on the API (`apps/api/.env`); see [Email](#email) below
- **Workflows**: `TRIGGER_SECRET_KEY` in app
- **Misc**: `REVALIDATION_SECRET`, `NEXT_PUBLIC_PORTAL_URL` in app

**Self-Hosted Mode:**
- Set `NEXT_PUBLIC_SELF_HOSTED=true` in `apps/app/.env` to mark the instance as self-hosted
- When enabled, organizations are automatically approved and bypass the payment/booking flow
- `STRIPE_SECRET_KEY` is not required for self-hosted instances

### Custom Domain

The API defaults to the hosted Comp AI domains (`*.trycomp.ai`). On your own domain, set these in the API environment, or login fails because the session cookie does not reach the app:

| Variable | Example | Purpose |
|---|---|---|
| `BASE_URL` | `https://api.compliance.example.com` | API URL (better-auth base URL) |
| `AUTH_COOKIE_DOMAIN` | `.compliance.example.com` | Session cookie scope. Must cover the `BASE_URL` host. |
| `AUTH_TRUSTED_ORIGINS` | `https://compliance.example.com,https://employee.compliance.example.com` | Exact frontend origins |
| `AUTH_TRUSTED_ORIGIN_SUFFIXES` | `.compliance.example.com` | Trusted HTTPS subdomains. Replaces the `*.trycomp.ai` / `*.trust.inc` defaults. |

In the app and portal, set `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PORTAL_URL` and `NEXT_PUBLIC_BETTER_AUTH_URL` (the API URL) to the same hosts.

Keep `AUTH_COOKIE_DOMAIN` as narrow as possible. Every host under it receives the session cookie, so never use a parent domain that also serves third-party or unrelated hosts.

### Service-token org signing

Internal callers (Trigger.dev workers, portal, trust site) authenticate to the API with `SERVICE_TOKEN_<SERVICE>` and sign the `x-organization-id` they act on with `SERVICE_TOKEN_SIGNING_SECRET_<SERVICE>` (`_TRIGGER`, `_PORTAL`, `_TRUST`). Each secret must be identical on the API and on that caller. Generate each with `openssl rand -hex 32`.

Roll it out in this order:

1. **API first.** Set `SERVICE_TOKEN_SIGNING_SECRET_TRIGGER`, `_PORTAL` and `_TRUST` on the API and deploy it. Leave `SERVICE_TOKEN_REQUIRE_ORG_SIGNATURE` unset (or `false`). Unsigned calls are still accepted with a warning.
2. **Callers.** Set the matching secret on the app and its Trigger.dev environment (`_TRIGGER`), the portal (`_PORTAL`) and the trust site (`_TRUST`), then deploy each. From now on, the API verifies every signed call and rejects an invalid signature.
3. **Enforce.** Once the API logs no more "called without a signed org claim" warnings, set `SERVICE_TOKEN_REQUIRE_ORG_SIGNATURE=true` on the API. It then rejects unsigned calls, and signed calls for a service whose secret is missing on the API.

If a caller is deployed with its secret before the API has it, the API accepts the signed call unverified and logs a warning (`... is not set; accepting UNVERIFIED org claim`) while enforcement is off. With enforcement on, it returns 401.

### Email

All email is sent by the API through a provider-agnostic transport (`packages/email/lib/transport`).
Templates are rendered to HTML and plain text with `@react-email/render` before sending.

| Variable | Purpose |
|----------|---------|
| `EMAIL_PROVIDER` | `cloudflare` or `resend`. Default: `cloudflare` if `CLOUDFLARE_EMAIL_API_TOKEN` is set, else `resend` if `RESEND_API_KEY` is set. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account that owns the sending domain |
| `CLOUDFLARE_EMAIL_API_TOKEN` | API token with only **Email Sending: Edit**. Store it in a secret manager. |
| `EMAIL_FROM_SYSTEM` / `EMAIL_FROM_DEFAULT` | Sender addresses on the verified sending domain (fall back to `RESEND_FROM_SYSTEM` / `RESEND_FROM_DEFAULT`) |
| `EMAIL_FROM_TRUST_PORTAL` | Optional Trust Portal sender (falls back to `RESEND_FROM_TRUST_PORTAL`, then the system sender) |
| `EMAIL_REPLY_TO` | Reply-To for all emails, e.g. your support mailbox (falls back to `RESEND_REPLY_TO_MARKETING` for marketing only) |
| `EMAIL_TO_TEST` | Optional. Redirects every email to one address (falls back to `RESEND_TO_TEST`) |
| `EMAIL_ALLOW_MARKETING` | Marketing emails are refused on Cloudflare unless `true`. Sender: `EMAIL_FROM_MARKETING` / `RESEND_FROM_MARKETING` |
| `RESEND_API_KEY` | Only when using the Resend provider |

**Cloudflare setup:** in the Cloudflare dashboard, enable Email Sending and verify your sending domain or subdomain (Cloudflare adds SPF, DKIM, and DMARC records). Then create an API token with only the Email Sending: Edit permission.

**Cloudflare limits enforced by the transport:**

- Up to 50 recipients (to + cc + bcc) per message. Larger sends are split into multiple messages.
- Messages over 4.5 MiB (including base64-encoded attachments) are rejected before sending. Link to the file in the app instead.
- 429 and 5xx responses are retried up to 3 attempts with backoff, honoring `Retry-After`.
- No native scheduling or batch endpoint: scheduled emails use a Trigger.dev `delay`, and batch sends fan out single sends (10 at a time).

`List-Unsubscribe` / `List-Unsubscribe-Post` headers are still added to notification emails, so one-click unsubscribe keeps working.

### HaloPSA (optional)

One Halo API application serves every client org. Its credential lives in the API and Trigger.dev worker environment; each org's `halopsa` connection only stores the Halo client ID (and optional site ID).

1. **API application:** Halo > Configuration > Integrations > Halo API > View Applications > New.
   - Authentication method: **Client ID and Secret (Services)**.
   - Login type: **Agent**, bound to a dedicated agent such as `CompAI Integration`.
   - Scopes: `read:customers read:tickets edit:tickets read:assets read:teams read:agents` (add `edit:customers` for client custom fields).
   - Copy the authorisation server URL and tenant name from Halo > Configuration > Integrations > Halo API > API Details.
2. **Environment (API and worker):**

| Variable | Example | Purpose |
|---|---|---|
| `HALOPSA_BASE_URL` | `https://portal.masri.tech` | Halo URL (resource base is `${HALOPSA_BASE_URL}/api`) |
| `HALOPSA_AUTH_URL` | `https://portal.masri.tech/auth` | Authorisation server from API Details (default `${HALOPSA_BASE_URL}/auth`) |
| `HALOPSA_TENANT` | `masri` | Hosted tenant name (sent as `?tenant=`) |
| `HALOPSA_CLIENT_ID` / `HALOPSA_CLIENT_SECRET` | | The API application |
| `HALOPSA_SCOPE` | see above | Optional scope override |
| `HALOPSA_WEBHOOK_SECRET` | long random string | Bearer secret Halo sends to the webhook |
| `HALOPSA_OUTBOX_PAUSED` | `true` | Stops sending to Halo. Events stay pending and replay when removed. |
| `HALOPSA_CUSTOM_FIELD_PREFIX` | `CFCompAI` | Prefix of the client custom fields the nightly posture push writes |

3. **Webhook:** Halo > Configuration > Integrations > Webhooks > New.
   - Type **Standard Webhook**, method **POST**, content type **application/json**, events **Ticket Closed** (and Ticket Updated).
   - Authentication **Bearer**, token = `HALOPSA_WEBHOOK_SECRET`.
   - Payload URL: `https://api.compliance.masri.tech/v1/integrations/halopsa/webhooks/<token>`. Generate `<token>` per client connection on the admin **HaloPSA** page (or `POST /v1/integrations/halopsa/connections/:id/webhook-token`); it is shown once.
4. **Map clients** on Admin > HaloPSA (bind to an existing org or create one), then enable triggers in each org's HaloPSA connection settings. Nothing is sent until a trigger is enabled.

**Posture push:** create client custom fields `CFCompAIScore` (number), `CFCompAIFrameworks` (text), `CFCompAIFailingChecks` (number), `CFCompAIOpenFindings` (number), `CFCompAILastSync` (date) and `CFCompAIUrl` (text) in Halo > Configuration > Custom Objects > Custom Fields (entity Client), and add `edit:customers` to the API application scopes. They are updated nightly at 06:30 UTC unless the connection turns off "Push compliance posture". The monthly PDF report (trigger "Monthly posture report") runs on the 1st at 09:00 UTC.

The weekly digest runs Monday 08:00 UTC for every org (no per-org timezone is stored yet). Webhook replay protection uses the Upstash KV (`UPSTASH_REDIS_REST_*`) and is skipped with a warning when it is not configured.

### Prerequisites

- Docker Desktop or Docker Engine
- External PostgreSQL 14+ with SSL
- Cloudflare Email Service (or a [Resend](https://resend.com) account) for email
- [Trigger.dev](https://cloud.trigger.dev) account for workflows

### Build & Run

```bash
# 1. Create env files from examples
cp packages/db/.env.example packages/db/.env
cp apps/app/.env.example apps/app/.env
cp apps/portal/.env.example apps/portal/.env
# Edit each with your production values

# 2. Export build args
export BETTER_AUTH_URL="https://app.yourdomain.com"
export BETTER_AUTH_URL_PORTAL="https://portal.yourdomain.com"

# 3. Build
docker compose build --no-cache

# 4. Migrate & seed
docker compose run --rm migrator
docker compose run --rm seeder

# 5. Start
docker compose up -d app portal
```

### Trigger.dev Deployment

Deploy tasks from your workstation (not inside Docker):

```bash
cd apps/app
bunx trigger.dev@latest login
bunx trigger.dev@latest deploy
```

### Troubleshooting

View logs to debug missing env vars:

```bash
docker compose logs app
docker compose logs portal
```

The Dockerfile sets `SKIP_ENV_VALIDATION=true` at build time, so missing variables only cause errors at runtime.

See the [full troubleshooting guide](https://trycomp.ai/docs/self-hosting/docker#troubleshooting) for common issues.
