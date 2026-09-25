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
- **Email**: `RESEND_API_KEY` in app and portal
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

### Prerequisites

- Docker Desktop or Docker Engine
- External PostgreSQL 14+ with SSL
- [Resend](https://resend.com) account for email
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
