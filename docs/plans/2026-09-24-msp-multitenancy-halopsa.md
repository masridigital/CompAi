# MSP/MSSP Readiness and HaloPSA Integration Plan

**Date:** 2026-09-24 · **Owner:** Masri · **Branch:** `claude/great-bardeen-33qwpl` · **Revision:** 3

**Goal:** Make this self-hosted fork work for an MSP/MSSP that runs many client organizations. HaloPSA (hosted by Halo on Microsoft Azure, custom domain `portal.masri.tech`) is the system of record for clients and tickets. CompAI runs at `compliance.masri.tech`. All email goes through Cloudflare Email Service.

**Hard constraint:** Keep the app structure as it is. No partner/parent model, no new product areas, and no re-architecture of tenancy, auth, or billing. Every change is additive: a new integration manifest, new tables for the Halo ticket state, small edits at named hook points, and admin tooling.

**Scope decisions:**

- Billing sync is out of scope. Client billing stays in Halo, and CompAI sends no billing data.
- White-label, partner consoles, and cross-instance tenancy are out of scope.

---

## 1. Why the current structure already fits one MSP

This fork is self-hosted by Masri. The instance itself is the MSP boundary:

| MSP need | Existing structure that covers it |
|---|---|
| One tenant per client | `Organization`, with every query scoped by `organizationId` |
| MSP staff in many clients | One `User` can hold `Member` rows in many orgs (`auth.prisma`). The org switcher already exists (`apps/app/src/components/organization-switcher.tsx`). |
| MSP owner/operator view across clients | Platform admin (`User.role === 'admin'`) plus `apps/api/src/admin-organizations/` (org list, activity, frameworks, tasks, findings, and more) |
| MSP operators not counted as client employees | `isOrgParticipant` (`packages/auth/src/participation.ts:37`) already excludes platform admins from training, policy sign-off, device agent, and compliance counts |
| One vendor secret shared by all clients | `IntegrationPlatformCredential` (one row per provider slug, platform-admin managed, `integration-platform.prisma:427`) |
| Per-client integration settings | `IntegrationConnection.variables` (JSON, per org) |
| Custom client roles | `OrganizationRole` (custom roles per org) |

The gaps are narrow: MSP techs who are not platform admins, a cross-client posture view, tooling to bulk-onboard clients, and HaloPSA itself.

---

## 2. MSP/MSSP-friendly changes (no structural change)

### 2.1 MSP tech accounts (non-admin)

**Problem:** Techs need access to many clients without platform-admin god mode, and they must not count as client employees.

**Change:**

1. Add one global user role, `msp_staff`, next to `admin` in the better-auth `admin()` plugin config (`apps/api/src/auth/auth.server.ts:521`).
2. In `packages/auth/src/participation.ts`, exclude `msp_staff` the same way as `admin`. This is a 2-line change: `NON_PARTICIPANT_ROLES = ['admin', 'msp_staff']`.
3. `msp_staff` gets NO platform-admin privileges. `PlatformAdminGuard` and `PermissionGuard` still check only `admin`.
4. Techs get normal `Member` rows in each client they support. A custom role `msp_tech` (admin without `organization:delete`, `apiKey:*`, `secret:read`) is created per org at provisioning.

### 2.2 Bulk staff assignment (admin tooling)

Add `POST /v1/admin/organizations/:id/msp-staff` to the existing `admin-organizations` controller (`PlatformAdminGuard`, audit-logged by `AdminAuditLogInterceptor`):

- Body: `{ userIds: string[], orgRole: string }`. The endpoint adds or reactivates the `Member` rows directly, with no invite email.
- The companion `DELETE` deactivates the rows.
- A script `apps/api/src/scripts/assign-msp-staff.ts` applies one staff list to all orgs (`--dry-run` by default).

### 2.3 Client posture view

Extend the existing admin organizations table (`apps/app/src/app/(app)/[orgId]/admin/organizations/`) instead of a new console. Add these columns to `GET /v1/admin/organizations`:

- Framework score, and failing integration checks
- Overdue tasks, and open findings
- Evidence that expires within 30 days
- Halo client name and link

The data comes from `ClientPostureSnapshot`, one new read-model table written nightly and after each org check run. This avoids N live queries per page load.

### 2.4 Client onboarding

Keep the existing `/setup` flow. Add one admin action: "Create org from Halo client" (Section 5.4). It calls the same org-creation logic, then binds the Halo client ID. No change to the onboarding structure.

### 2.5 Security fixes that matter for many tenants

| # | Finding | Evidence | Fix |
|---|---|---|---|
| S1 | Service tokens accept any org ID in `x-organization-id` | `apps/api/src/auth/hybrid-auth.guard.ts:101-116` | Require an HMAC-signed org claim (org ID + timestamp) from the portal, trust, and trigger callers |
| S2 | DSL `code` steps run arbitrary JS in the API process | `packages/integration-platform/src/dsl/interpreter.ts:637-638` | Run code steps in `isolated-vm` with no `process`, a memory cap, and a timeout |
| S3 | One `ENCRYPTION_KEY` protects every client's credentials | `apps/api/src/integration-platform/services/credential-vault.service.ts:93` | Store `ENCRYPTION_KEY` in Azure Key Vault. Envelope encryption is optional later. |
| S4 | `Member` has no `@@unique([userId, organizationId])` | `packages/db/prisma/schema/auth.prisma` | Deduplicate, then add the constraint. Bulk staff assignment depends on it. |
| S6 | No MFA plugin | `apps/api/src/auth/auth.server.ts` | Add the better-auth `twoFactor` plugin. Enforce it for `admin` and `msp_staff`. |

---

## 3. Deployment: domains and email

### 3.1 Host layout

| Host | Service | Env var |
|---|---|---|
| `compliance.masri.tech` | App (`apps/app`) | `NEXT_PUBLIC_APP_URL` |
| `api.compliance.masri.tech` | API (`apps/api`), better-auth base URL, Halo webhook target | `BASE_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` |
| `employee.compliance.masri.tech` | Employee portal (`apps/portal`) | `NEXT_PUBLIC_PORTAL_URL` |
| `portal.masri.tech` | HaloPSA (hosted by Halo, not ours) | `HALOPSA_BASE_URL` |

The employee portal does not use `portal.compliance.masri.tech`. That name is too close to the Halo host `portal.masri.tech`, and users and techs would mix them up.

### 3.2 Session cookie scope (security)

- Set the cookie domain to `.compliance.masri.tech`. It covers the app, API, and employee portal.
- **Never set it to `.masri.tech`.** The browser then sends the CompAI session cookie to `portal.masri.tech` (Halo's servers) and to every other `masri.tech` host. A compromise of any of those hosts would expose CompAI sessions for all clients.

**Status: implemented** (`apps/api/src/auth/cookie-domain.ts`, `apps/api/src/auth/origin-policy.ts`). Set these in the API env for this deployment:

```env
BASE_URL="https://api.compliance.masri.tech"
AUTH_COOKIE_DOMAIN=".compliance.masri.tech"
AUTH_TRUSTED_ORIGINS="https://compliance.masri.tech,https://employee.compliance.masri.tech"
AUTH_TRUSTED_ORIGIN_SUFFIXES=".compliance.masri.tech"
```

- The API refuses to start if `AUTH_COOKIE_DOMAIN` does not cover the `BASE_URL` host, or is a bare TLD.
- With `AUTH_TRUSTED_ORIGIN_SUFFIXES` set, the hosted `*.trycomp.ai` and `*.trust.inc` origins are no longer trusted by your API.
- `https://portal.masri.tech` (Halo) is not trusted.

### 3.3 DNS and edge (Cloudflare)

- Proxy all three hosts through Cloudflare (orange cloud), with origin certificates and Full (strict) TLS.
- Use a Cloudflare Tunnel to the Azure origin, so the origin has no public inbound port.
- WAF: allow unauthenticated traffic on `api.compliance.masri.tech` only for `/api/auth/*`, `/v1/integrations/halopsa/webhooks/*`, and the other `@Public()` webhook paths. Rate-limit the webhook path.
- Deploy the origin in the same Azure region as the Halo tenant.

### 3.4 Email: Cloudflare Email Service

**Decision:** Replace Resend with Cloudflare Email Service (REST API). Keep Resend as a fallback provider behind the same interface.

**Facts** (Cloudflare Email Sending, public beta since 2026-04-16):

- Endpoint: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send`, `Authorization: Bearer <token>`.
- Token permission: `Email Sending: Edit`. Create a dedicated token with only this permission.
- Body: `to`, `from`, `subject`, `html`, `text`, plus `cc`, `bcc`, `replyTo`, `attachments`, and `headers`.
- Limits:
  - 50 recipients per message (to + cc + bcc combined).
  - 5 MiB per message, including attachments.
  - One sending domain per subscription: the zone apex or a verified sending subdomain.
- SMTP is also available (`smtp.mx.cloudflare.net:465`). We use REST.
- Cloudflare has no `scheduledAt` and no batch endpoint.

**Sending domain:** Verify `compliance.masri.tech` as the sending subdomain in the `masri.tech` zone. Cloudflare adds SPF, DKIM, and DMARC records. Use these addresses:

- `EMAIL_FROM_SYSTEM`: `Masri Compliance <no-reply@compliance.masri.tech>`
- `EMAIL_FROM_DEFAULT`: `Masri Compliance <notifications@compliance.masri.tech>`
- `EMAIL_REPLY_TO`: the Masri support mailbox, so client replies land in Halo as tickets

**Current Resend call sites (4):**

| File | Change |
|---|---|
| `packages/email/lib/resend.ts:92` (`sendEmail`, used by magic link, invites, policy, digest, and training emails) | Call the transport instead of `resend.emails.send` |
| `apps/api/src/email/resend.ts:66` | Same |
| `apps/api/src/trigger/email/send-email.ts:100` | Same. Replace `scheduledAt` with Trigger.dev `delay` on the task trigger. |
| `apps/api/src/trigger/email/send-batch-email.ts:70` (`resend.batch.send`) | Loop over single sends in a Trigger.dev queue (concurrency 10) |

**New code:** `packages/email/lib/transport/` with these files:

- `types.ts` (`EmailTransport` interface)
- `cloudflare.ts` (REST client, zod response check, 429 backoff)
- `resend.ts` (current logic moved here)
- `index.ts` (picks the provider from `EMAIL_PROVIDER=cloudflare|resend`)

Render React templates to HTML and text with `@react-email/render`, which is already a dependency. Resend did this step internally. Keep the `sendEmail` signature, so no template or caller changes.

**Behavior rules:**

- Send each email to one recipient. Emails to more than 50 recipients split into chunks.
- Reject attachments over 4.5 MiB before send, with a clear error. Link to the file in the app instead.
- Add `List-Unsubscribe` headers through `headers`, so the existing unsubscribe flow (`packages/email/lib/check-unsubscribe.ts`) keeps working.
- Marketing sends (`RESEND_FROM_MARKETING`) are not used on this instance. The transport refuses `marketing: true` unless `EMAIL_ALLOW_MARKETING=true`.

**Env:**

- `EMAIL_PROVIDER=cloudflare`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_EMAIL_API_TOKEN`
- `EMAIL_FROM_SYSTEM`, `EMAIL_FROM_DEFAULT`, `EMAIL_REPLY_TO`

The transport also reads the old `RESEND_FROM_*` names as a fallback.

**Tests:**

- Cloudflare transport: request shape, 50-recipient split, attachment size guard, 429 retry, and error mapping (fetch mocked).
- `sendEmail`: the provider switch.
- Store the Cloudflare token in Azure Key Vault. It is never logged.

---

## 4. HaloPSA facts (hosted on Azure)

Halo base URL: `https://portal.masri.tech` (custom domain on a Halo-hosted tenant). Confirm field and scope names on `https://portal.masri.tech/apidoc` before coding. Halo changes them between versions.

- **API app:** Halo > Configuration > Integrations > Halo API > View Applications > New.
  - Authentication method: Client ID and Secret (Services).
  - Login type: Agent. Bind it to a dedicated agent, `CompAI Integration`, so the Halo audit trail shows the integration by name.
- **Scopes:** `read:customers read:tickets edit:tickets read:assets read:teams read:agents`.
  - Add `edit:customers` only for the client custom-field push (5.3).
  - Missing scopes can make ticket writes fail silently. The integration test checks each scope.
- **Hosted auth:** Copy the authorisation server URL and the tenant name from Halo > Configuration > Integrations > Halo API > API Details. Do not guess them.
  - Token: `POST https://portal.masri.tech/auth/token?tenant={tenant}`. If API Details shows a different authorisation server (for example the `*.halopsa.com` host), use that value. It goes in `HALOPSA_AUTH_URL`.
  - Form body: `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`.
  - Resource base: `https://portal.masri.tech/api` (`HALOPSA_BASE_URL`)
  - Send `Authorization: Bearer <token>`. Tokens are short-lived: cache each one until 60 s before `expires_in`.
- **Paging:** Send `pageinate=true&page_size=100&page_no=N` (Halo's spelling). Without `pageinate=true`, Halo ignores the page size and returns the agent default (50). Responses carry `record_count`.
- **Writes:** POST bodies are arrays (`[{…}]`).
  - Create or update tickets: `POST /Tickets`.
  - Add notes: `POST /Actions`.
- **Webhooks:** Halo > Configuration > Integrations > Webhooks.
  - Type: Standard Webhook, POST, `application/json`.
  - Events include New Ticket Logged, Ticket Updated, and Closed.
  - Authentication options include None, Basic, and Bearer.
  - Payload URL: `https://api.compliance.masri.tech/v1/integrations/halopsa/webhooks/{connectionToken}`, with Bearer authentication.
- **Azure hosting impact:**
  1. Halo calls our webhook from Azure egress IPs that Halo does not publish. We cannot IP-allowlist it. Protect the endpoint with a bearer secret plus an unguessable connection path.
  2. The webhook endpoint must be public. Put it behind Cloudflare (Tunnel or WAF rule on `/v1/integrations/halopsa/webhooks/*` only).
  3. Deploy the CompAI instance in the same Azure region as the Halo tenant to keep API latency low. Halo shows the region in the tenant's hosting details.
  4. Ticket and custom-field deep links use `https://compliance.masri.tech/{orgId}/...`.

---

## 5. HaloPSA functionality decision

### 5.1 Summary

| Direction | Feature | Decision | Priority |
|---|---|---|---|
| Sync: Halo to CompAI | Client to org mapping | **Build** | P1 |
| Sync: Halo to CompAI | Client contacts to People | **Build, off by default.** Use only for clients without Entra or Google Workspace. The org `employeeSyncProvider` field picks one source. | P2 |
| Sync: Halo to CompAI | Assets to Devices | **Do not build.** NinjaOne and Intune are better device sources, and Halo assets usually come from the RMM anyway. | none |
| Sync: Halo to CompAI | Agents and teams | **Build (read-only cache)** for ticket routing dropdowns | P1 |
| Alerting: CompAI to Halo | Tickets for failing integration checks | **Build** | P1 |
| Alerting: CompAI to Halo | Tickets for new pentest and audit findings | **Build** | P1 |
| Alerting: CompAI to Halo | Tickets for noncompliant devices (device agent, Fleet) | **Build** | P1 |
| Alerting: CompAI to Halo | Weekly due-items digest ticket per client | **Build** | P2 |
| Alerting: Halo to CompAI | Ticket closed: note on the CompAI task | **Build.** It never marks a task done. The next check run decides. | P1 |
| Reporting: Halo to CompAI | Evidence checks from Halo ticket data | **Build (4 checks)** | P2 |
| Reporting: CompAI to Halo | Compliance score on Halo client custom fields | **Build** | P2 |
| Reporting: CompAI to Halo | Monthly posture report PDF attached to a Halo ticket | **Build** | P3 |
| Billing | Any billing sync | **Out of scope** | none |

**Reasons:**

- Halo is where techs work, so alerts must land there as tickets, not as email.
- Halo is also where account managers report. Posture data must reach Halo custom fields, so Halo's own report builder and dashboards can use it.
- CompAI stays the source of truth for compliance state. A Halo ticket closing is a signal, not evidence.

### 5.2 Alerting rules

| Trigger | Ticket granularity | Default priority | Resolve behavior |
|---|---|---|---|
| Integration check fails | 1 ticket per check per client, with failing resources listed (first 50, then a count) | P3 (P2 if the check severity is high or critical) | Check passes: add a private note, set the configured resolved status |
| Pentest or audit finding created | 1 ticket per finding | Mapped from finding severity: critical P1, high P2, medium P3, low P4 | Finding closed in CompAI: add a note and resolve |
| Device noncompliant for more than 24 h | 1 ticket per device | P3 | Device compliant: add a note and resolve |
| Weekly digest (Monday 08:00 in the client's timezone) | 1 ticket per client, only when items exist | P4 | Opened fresh each week, and the previous one is closed |

Digest contents: overdue tasks, evidence that expires in 30 days, policies due for review, vendors due for review, and risks above the threshold.

**Repeat failure:** add a private note to the open ticket. Do not open a new ticket.

**Regression after resolve:** reopen the same ticket for 7 days. After 7 days, open a new ticket.

Per-client settings live in the Halo connection's `variables`, validated by zod:

- Ticket type, team, and agent
- Priority map, and resolved status ID
- Enabled triggers, and minimum severity

Global defaults come from the platform-level connection settings. There is no new rules table.

### 5.3 Reporting to Halo: custom fields

Create these client-level custom fields in Halo (Configuration > Custom Objects > Custom Fields, entity Client):

- `CFCompAIScore` (number)
- `CFCompAIFrameworks` (text)
- `CFCompAIFailingChecks` (number)
- `CFCompAIOpenFindings` (number)
- `CFCompAILastSync` (date)
- `CFCompAIUrl` (text, `https://compliance.masri.tech/{orgId}`)

The nightly job pushes values with `POST /Client` `[{ id, customfields: [{ name, value }] }]` after the posture snapshot runs. Halo reports and dashboards can then show compliance across all clients, next to SLA and ticket data.

### 5.4 Sync: client mapping

- The nightly `halopsa-sync-clients` job reads `GET /Client` (active clients only) and caches ID, name, and website.
- A client is bound to an org by `IntegrationConnection.variables.haloClientId` (and `haloSiteId`) on the org's `halopsa` connection. There is no new mapping table.
- Admin UI (existing admin organizations page) shows three lists: unmapped Halo clients, unmapped orgs, and auto-match suggestions (normalized name, website domain).
- Actions per row: bind to an existing org, create an org from this Halo client, or ignore.

### 5.5 Reporting from Halo: evidence checks

| Check ID | Logic | Maps to |
|---|---|---|
| `halopsa_incident_response` | Security-incident tickets for the client in the last 90 days each have a resolution note and closed within the SLA variable. Zero incidents passes, with evidence. | `TASK_TEMPLATES.incidentResponse` |
| `halopsa_access_review` | A recurring access-review ticket closed in the last 90 days | `TASK_TEMPLATES.accessReviewLog` |
| `halopsa_employee_access` | Joiner and leaver tickets closed within N hours (variable) | `TASK_TEMPLATES.employeeAccess` |
| `halopsa_change_management` | Change tickets carry an approval | New task template needed. No change-management template exists in `packages/integration-platform/src/task-mappings.ts`. Add one in the framework editor first. |

The ticket type IDs for incident, access review, joiner/leaver, and change are set in the connection `variables`.

---

## 6. Implementation

### 6.1 Credentials: one Halo secret for all clients

**Decision (revised):** Keep the Halo API app credential in environment variables, loaded from Azure Key Vault. Reason: `IntegrationPlatformCredential` is only read for OAuth2 manifests, and Halo uses the client-credentials grant. Env keeps the platform code unchanged.

| Env var | Value |
|---|---|
| `HALOPSA_BASE_URL` | `https://portal.masri.tech` |
| `HALOPSA_AUTH_URL` | Authorisation server from Halo API Details (default `${HALOPSA_BASE_URL}/auth`) |
| `HALOPSA_TENANT` | Tenant name from Halo API Details (sent as `?tenant=`) |
| `HALOPSA_CLIENT_ID`, `HALOPSA_CLIENT_SECRET` | Halo API application |
| `HALOPSA_SCOPE` | `read:customers read:tickets edit:tickets read:assets read:teams read:agents` (add `edit:customers` for 5.3) |

- Each client org's `halopsa` connection uses `custom` auth with two fields: `haloClientId` (required) and `haloSiteId` (optional). It stores no secret.
- Rotate the Halo secret once, in Key Vault.

### 6.2 Code layout (additive)

| Path | Content |
|---|---|
| `packages/integration-platform/src/manifests/halopsa/` | Manifest (`auth: custom`, capabilities `checks`, `sync`), 4 checks, variables schema |
| `packages/integration-platform/src/manifests/halopsa/client/` | `auth.ts` (token cache), `http.ts` (paging, 429 backoff), `schemas.ts` (zod for Halo responses), `tickets.ts`, `clients.ts`, `custom-fields.ts` |
| `apps/api/src/integration-platform/halopsa/` | `halopsa-alert.service.ts` (event to outbox), `halopsa-outbox.service.ts`, `halopsa-webhook.controller.ts`, `halopsa-mapping.controller.ts` |
| `apps/api/src/trigger/integration-platform/halopsa/` | `drain-halopsa-outbox.ts`, `halopsa-sync-clients.ts`, `halopsa-push-posture.ts`, `halopsa-weekly-digest.ts`, `halopsa-reconcile-tickets.ts` |
| `packages/db/prisma/schema/halopsa.prisma` | 2 tables (6.3) |

Register the manifest in `packages/integration-platform/src/registry/index.ts`. Keep each file under 300 lines.

### 6.3 New tables

```prisma
enum HaloTicketLinkState {
  pending_create
  open
  resolved
  closed_externally
}

model HaloTicketLink {
  id             String              @id @default(dbgenerated("generate_prefixed_cuid('htl'::text)"))
  organizationId String
  connectionId   String
  entityType     String              // check | finding | device | digest
  entityId       String
  dedupKey       String
  refToken       String              @unique // e.g. CAI-7Q2K, placed in the ticket summary
  haloTicketId   Int?
  state          HaloTicketLinkState @default(pending_create)
  resolvedAt     DateTime?
  lastEventAt    DateTime            @default(now())
  createdAt      DateTime            @default(now())

  organization Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  connection   IntegrationConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([organizationId, dedupKey])
  @@index([state])
}

enum HaloOutboxStatus {
  pending
  processing
  done
  dead
}

model HaloOutboxEvent {
  id             String           @id @default(dbgenerated("generate_prefixed_cuid('hob'::text)"))
  organizationId String
  linkId         String
  kind           String           // create_ticket | add_note | set_status | reopen | push_custom_fields
  payload        Json
  status         HaloOutboxStatus @default(pending)
  attempts       Int              @default(0)
  nextAttemptAt  DateTime         @default(now())
  lastError      String?
  createdAt      DateTime         @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
}
```

`ClientPostureSnapshot` (Section 2.3) is the only other new table.

### 6.4 Event flow

1. **Hook points** (the only edits to existing files):
   - `apps/api/src/trigger/integration-platform/run-task-integration-checks.ts`, after the task status transition (about lines 440-547): call `haloAlertService.onCheckResult()`.
   - `apps/api/src/findings/finding-notifier.service.ts`: call `onFindingCreated()` and `onFindingClosed()`.
   - Device compliance evaluation (device agent and Fleet policy result writers): call `onDeviceCompliance()`.
2. **`HaloAlertService`** loads the org's `halopsa` connection. It exits when the connection is missing or the trigger is off. Then, in one transaction, it upserts `HaloTicketLink` by `dedupKey` and writes a `HaloOutboxEvent`.
3. **`drain-halopsa-outbox`** (Trigger.dev queue, concurrency 5):
   - Retry with backoff (30 s, 2 m, 10 m, 1 h, 6 h) and honor `429`. After 8 attempts the event goes `dead` and shows on the admin page with a Retry button.
   - After an ambiguous timeout on `create_ticket`, search the client's open tickets for `refToken` before a retry. This prevents duplicate tickets.
4. **Webhook:** `POST /v1/integrations/halopsa/webhooks/:connectionToken` (`@Public()`).
   - Check the bearer secret in constant time, and drop replays by body hash for 24 h (`packages/kv`).
   - On Closed: set the link to `closed_externally` and add a comment on the linked CompAI task: "Halo ticket #{id} closed by {agent}: {resolution}".
5. **`halopsa-reconcile-tickets`** (hourly) polls open links, because webhooks are best effort.

### 6.5 Ticket content

- Summary: `[CompAI] {check or finding} failing ({n} resources) [{refToken}]`
- Details (HTML):
  - Client and frameworks affected
  - Failing resources table
  - Remediation text from `IntegrationCheckResult`
  - Deep link to the CompAI task
- Ticket fields set: `client_id`, `site_id`, `tickettype_id`, `team_id`, `agent_id`, `priority_id`.
- Pass all text through `apps/api/src/utils/redact-secrets.ts` before it enters the outbox.

---

## 7. Milestones

These estimates assume one engineer who knows the codebase.

| # | Milestone | Weeks | Exit criteria |
|---|---|---|---|
| M0 | Security fixes S1-S4, S6 | 1.5 | New guard tests green |
| M0.5 | Domains (cookie and origin env), Cloudflare edge, Cloudflare email transport | 1 | Login works across `compliance.`, `api.`, and `employee.compliance.masri.tech`. Magic link and invite emails arrive with SPF, DKIM, and DMARC pass. |
| M1 | `msp_staff` role, bulk staff assignment, posture columns | 1.5 | A tech sees only assigned clients and is excluded from employee counts |
| M2 | Halo manifest, platform credential, client mapping, create-org-from-client | 1.5 | All Masri Halo clients mapped |
| M3 | Alerting: outbox, check, finding, and device tickets, webhook, reconcile | 2.5 | Failing check opens 1 ticket, repeat adds a note, pass resolves. 0 duplicates when the worker is killed mid-send. |
| M4 | Custom-field posture push, weekly digest, 4 evidence checks | 2 | Halo client record shows the CompAI score. Checks write evidence JSON to tasks. |
| M5 | Monthly PDF report to Halo | 1 | PDF attached to a Halo ticket for a pilot client |
| | **Total** | **11** | |

## 8. Tests, rollout, rollback

**Tests** (every feature ships with tests, per `CLAUDE.md`):

- Jest: alert service dedup, outbox retry, webhook auth and replay, credential resolution, participation for `msp_staff`, and the bulk staff endpoint (admin allowed, non-admin 403).
- Halo contract tests: fixtures recorded from the Masri Halo tenant, validated with `schemas.ts`, with HTTP mocked by `msw`.

**Rollout:**

1. Gate Halo alerting per org with the connection `variables.enabledTriggers` (empty by default).
2. Pilot one client for 2 weeks with notes only, then enable resolve.

**Rollback:**

- All schema changes are additive.
- Turn off alerting with `HALOPSA_OUTBOX_PAUSED=true`. Events stay `pending` and replay when you remove the flag.
- Delete an org's `halopsa` connection to unbind that client.

## 9. Fork and license

- **Upstream merges:** Add `upstream` (`trycompai/comp`) and merge it weekly. The hook-point list in 6.4 is the complete set of core-file edits.
- **License:** AGPL-3.0, Section 13. If clients use the modified platform over the network, Masri must offer them the modified source.
