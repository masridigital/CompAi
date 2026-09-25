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
