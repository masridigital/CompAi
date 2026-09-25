# Masri Deployment: compliance.masri.tech

This kit runs the platform on one Azure VM behind a Cloudflare Tunnel. The VM publishes no inbound port.

| Host | Service | Container |
|---|---|---|
| `compliance.masri.tech` | App | `app:3000` |
| `api.compliance.masri.tech` | API, login, Halo webhook | `api:3333` |
| `employee.compliance.masri.tech` | Employee portal | `portal:3000` |
| `portal.masri.tech` | HaloPSA (Halo-hosted, not in this stack) | n/a |

Managed services outside the VM:

- **Postgres:** Azure Database for PostgreSQL flexible server, in the same region as the Halo tenant.
- **Object storage:** Cloudflare R2 (S3-compatible, through `APP_AWS_ENDPOINT`).
- **Email:** Cloudflare Email Service.
- **Background jobs:** Trigger.dev, cloud or self-hosted v4.
- **Secrets:** Azure Key Vault.

## 1. Prerequisites

1. `masri.tech` is a Cloudflare zone.
2. Create an Azure VM (Ubuntu 24.04, 4 vCPU / 16 GB minimum) with Docker Engine and the Compose plugin. Deny all inbound traffic in the NSG except SSH from your admin IP, or use Azure Bastion.
3. Create Azure Database for PostgreSQL flexible server 16:
   - Private access (VNet integration) with the VM, or public access limited to the VM IP.
   - `require_secure_transport=on`.
   - Database `compai`.
4. Create an Azure Key Vault. Give the VM a managed identity with `Key Vault Secrets User`.

## 2. Secrets

Generate secrets:

```bash
for n in SECRET_KEY ENCRYPTION_KEY AUTH_SECRET; do echo "$n=$(openssl rand -base64 32)"; done
for n in INTERNAL_API_TOKEN SERVICE_TOKEN_TRIGGER SERVICE_TOKEN_PORTAL REVALIDATION_SECRET \
         HALOPSA_WEBHOOK_SECRET UPSTASH_REDIS_REST_TOKEN REDIS_PASSWORD; do
  echo "$n=$(openssl rand -hex 32)"
done
```

Store each value in Key Vault. Then render the env files on the VM at boot. Example, using the VM managed identity:

```bash
az login --identity
render() { # $1 = template, $2 = output
  cp "$1" "$2"
  for key in $(grep -oE '^[A-Z_]+=' "$1" | tr -d '='); do
    secret=$(az keyvault secret show --vault-name kv-masri-compliance \
      --name "${key//_/-}" --query value -o tsv 2>/dev/null) || continue
    [ -n "$secret" ] && sed -i "s|^$key=.*|$key=$secret|" "$2"
  done
  chmod 600 "$2"
}
cd deploy/masri
render .env.example .env
for f in db api app portal; do render env/$f.env.example env/$f.env; done
```

Rules:

- `SECRET_KEY` is the same in the API and the app. The portal's `BETTER_AUTH_SECRET` uses the same value.
- `INTERNAL_API_TOKEN` and `SERVICE_TOKEN_TRIGGER` are the same everywhere they appear.
- `ENCRYPTION_KEY` protects every stored integration credential. Back it up. If you lose it, every integration must be reconnected.
- `env/*.env` and `.env` are git-ignored. Never commit them.

## 3. Cloudflare

1. **Tunnel:** Zero Trust > Networks > Tunnels > Create (cloudflared).
   - Copy the token into `CLOUDFLARE_TUNNEL_TOKEN`.
   - Add 3 public hostnames. Each one must match `cloudflared/config.yml`.
2. **SSL/TLS:** Full (strict). Always Use HTTPS on. Minimum TLS 1.2. HSTS on for `compliance.masri.tech` and its subdomains.
3. **WAF:** Apply the rules in [cloudflare-waf.md](./cloudflare-waf.md).
4. **Email Sending:**
   - Email > Email Sending: add `compliance.masri.tech` as the sending domain. Cloudflare adds SPF, DKIM, and DMARC records.
   - Create an API token with only `Email Sending: Edit`, and put it in `CLOUDFLARE_EMAIL_API_TOKEN`.
5. **R2:**
   - Create the buckets named in `env/api.env.example`.
   - Create an R2 API token (Object Read & Write, limited to those buckets). Its keys go in `APP_AWS_ACCESS_KEY_ID` / `APP_AWS_SECRET_ACCESS_KEY`.
   - Add a CORS rule on the attachments bucket for `https://compliance.masri.tech` and `https://employee.compliance.masri.tech` (GET, PUT, HEAD).

## 4. HaloPSA

1. **API app:** Halo > Configuration > Integrations > Halo API > View Applications > New.
   - Authentication method: Client ID and Secret (Services).
   - Login type: Agent. Agent: a dedicated `CompAI Integration` agent.
   - Permissions: `read:customers edit:customers read:tickets edit:tickets read:assets read:teams read:agents`.
2. **Env values:** Copy the authorisation server and the tenant from API Details into `HALOPSA_AUTH_URL` and `HALOPSA_TENANT`. Copy the client ID and secret into `HALOPSA_CLIENT_ID` and `HALOPSA_CLIENT_SECRET`.
3. **Custom fields:** Create the client custom fields listed in plan section 5.3 (`CFCompAIScore`, `CFCompAIFrameworks`, `CFCompAIFailingChecks`, `CFCompAIOpenFindings`, `CFCompAILastSync`, `CFCompAIUrl`).
4. **Webhook:** Do this after first deploy.
   1. Generate a connection token in the app (Admin > HaloPSA).
   2. In Halo > Configuration > Integrations > Webhooks, add a Standard Webhook: POST, `application/json`, Bearer authentication with `HALOPSA_WEBHOOK_SECRET`.
   3. Payload URL: `https://api.compliance.masri.tech/v1/integrations/halopsa/webhooks/<token>`.
   4. Events: Ticket Updated, Closed.
5. **Scope check:** Check field and scope names against `https://portal.masri.tech/apidoc` before you turn on alerting.

## 5. Build and deploy

```bash
cd /opt/compai            # repo checkout, branch with this kit
C="docker compose -f deploy/masri/docker-compose.yml --env-file deploy/masri/.env"
$C build
$C --profile ops run --rm migrator          # apply Prisma migrations
$C up -d
$C ps                                        # all services healthy
```

Deploy the Trigger.dev tasks (API and app projects) from a workstation or CI with the same env:

```bash
cd apps/api && TRIGGER_PROJECT_ID=<id> bunx trigger.dev@latest deploy
cd apps/app && TRIGGER_APP_PROJECT_ID=<id> bunx trigger.dev@latest deploy
```

For self-hosted Trigger.dev, also set `TRIGGER_API_URL` in the API and app env and on the deploy command.

## 6. First-run setup

1. Sign in at `https://compliance.masri.tech` with your Masri account.
2. Promote yourself to platform admin. This is a one-time SQL statement; nothing else grants it:
   ```sql
   UPDATE "User" SET role = 'admin' WHERE email = 'joe@masri.tech';
   ```
3. Enable 2FA when prompted. Admin and `msp_staff` accounts must have 2FA.
4. Set tech accounts to `msp_staff`: Admin > Users, or `PATCH /v1/admin/users/:userId/role`.
5. Admin > HaloPSA: bind Halo clients to orgs (or create orgs from Halo clients). Then assign MSP staff to orgs.
6. Per client: turn on alert triggers in the HaloPSA connection settings. Pilot one client with notes only for 2 weeks.

## 7. Validation

| Check | Expected |
|---|---|
| `curl -sI https://api.compliance.masri.tech/v1/health` | `200` |
| Log in on `compliance.masri.tech`, then open `employee.compliance.masri.tech` | Same session, no second login |
| Browser devtools > cookies | `__Secure-better-auth.session_token` with domain `.compliance.masri.tech`. It never shows domain `.masri.tech`. |
| CORS from Halo: `curl -sI -H 'Origin: https://portal.masri.tech' https://api.compliance.masri.tech/v1/health` | No `access-control-allow-origin` for that origin |
| Send a magic-link login | Email arrives. The headers show `spf=pass dkim=pass dmarc=pass`. |
| HaloPSA connection "Test" on a client org | Success, and the Halo client name shows |
| Failing check on the pilot client | 1 Halo ticket with `[CAI-xxxx]` in the summary |
| Direct VM IP on 80/443/3000/3333 from outside | Connection refused or timed out |

## 8. Operations

- **Update:** `git pull && $C build && $C --profile ops run --rm migrator && $C up -d`.
- **Rollback:** Check out the previous tag, rebuild, and run `$C up -d`. The MSP schema changes are additive, so old code runs on the new schema. Do not roll back migrations.
- **Pause Halo alerting:** Set `HALOPSA_OUTBOX_PAUSED=true` in `env/api.env` and restart the API and the Trigger.dev tasks. Events queue and replay after you unpause.
- **Backups:** Azure Postgres automated backups (35-day retention, geo-redundant). R2 bucket versioning on. Keep `ENCRYPTION_KEY` in Key Vault with soft-delete and purge protection.
- **Logs:** `$C logs -f api`. Container logs rotate at 10 MB x 5.
