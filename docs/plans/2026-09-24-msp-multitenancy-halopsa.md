# MSP Multi-Tenancy and HaloPSA Integration Plan

**Date:** 2026-09-24 · **Owner:** Masri · **Branch:** `claude/great-bardeen-33qwpl`

**Goal:** Run this fork as an MSP platform. One MSP (a "partner") manages many client organizations from one console. Partner staff get delegated access to clients, and partner-level integration connections serve all clients. Partner baselines seed new clients, and a portfolio view shows posture across all clients. HaloPSA is the system of record for clients, tickets, and billing.

**Principles:**

1. Keep MSP code in new modules and new Prisma files. Touch core files only at named hook points. Upstream (`trycompai/comp`) ships daily, and merge cost must stay low.
2. Reuse the existing RBAC engine. Do not build a second permission path inside client orgs.
3. API first. Every feature is a NestJS endpoint with guards and `@RequirePermission`, per `CLAUDE.md` and the `api-endpoint-contract` skill.
4. Send every write to an external system through an outbox with retries and idempotency.

---

## 1. Review findings

### 1.1 Current state vs. MSP gap

| Area | Current state (evidence) | Gap for MSP |
|---|---|---|
| Tenancy | Flat `Organization`. No parent, partner, or reseller concept (`packages/db/prisma/schema/organization.prisma`). | No way to group clients under an MSP. |
| Access | Session `activeOrganizationId` plus a required `Member` row (`apps/api/src/auth/hybrid-auth.guard.ts:206-234`). The only cross-org role is platform admin (`User.role === 'admin'`), and it bypasses all permission checks (`apps/api/src/auth/permission.guard.ts:119-121`). | An MSP tech needs either god mode or a manual `Member` row in every client. Neither scales or is safe. |
| Org creation | Next.js server action `apps/app/src/app/(app)/setup/actions/create-organization.ts` plus `initializeOrganization` (`actions/organization/lib/initialize-organization.ts:456`). | No API for provisioning. No bulk onboarding. The server action conflicts with the "migrate to API" rule in `CLAUDE.md`. |
| Billing | One Stripe customer per org (`organization-billing.prisma`). Platform access is the manual `hasAccess` flag. SKUs are add-ons only (`packages/billing/src/sku-definitions.ts`). | No consolidated partner billing. No usage feed to a PSA. |
| Integrations | Connections are per org (`IntegrationConnection.organizationId`). A platform-level OAuth app fallback exists (`apps/api/src/integration-platform/services/oauth-credentials.service.ts:47-75`), and the Azure manifest uses a multi-tenant Entra app (`packages/integration-platform/src/manifests/azure/index.ts:32-73`). | The MSP owns one NinjaOne, one Halo, and one multi-tenant M365 app. Today each client needs its own connection and its own credentials. |
| PSA / RMM | ConnectWise, NinjaOne, Datto RMM, Kaseya, N-able, ServiceNow, Freshservice, Jira, and Linear exist as read-only dynamic checks (`integrations-catalog/integrations/*.json`). | No HaloPSA, Autotask, or Syncro. No outbound ticket creation anywhere in the repo. |
| Webhooks | Inbound `POST /v1/integrations/webhooks/:providerSlug/:connectionId` with HMAC check (`controllers/webhook.controller.ts:63-213`). No manifest uses it. | Usable pattern, but not wired to any PSA. |
| Notifications | Email only (Resend, Novu). Per-org, per-role toggles (`notification-policy.prisma`). | No Teams, Slack, or PSA channel. |
| Portfolio view | None. The `[orgId]` layout rejects non-members. Only platform-admin tools span orgs (`apps/api/src/admin-organizations/`). | No cross-client dashboard. |
| 2FA | `apps/api/src/auth/auth.server.ts` does not load the better-auth `twoFactor` plugin. | Partner staff with access to many tenants need enforced MFA. |

### 1.2 Security findings to fix before MSP work (Phase 0)

These are safe to live with in a single-company deployment. They become cross-tenant risks when one MSP operates many clients on one instance.

| # | Finding | Evidence | Risk in MSP mode | Fix |
|---|---|---|---|---|
| S1 | Service tokens accept any org ID in `x-organization-id`. The guard only checks that the org exists. | `hybrid-auth.guard.ts:101-116` | A leaked `portal` or `trust` token reaches every tenant within that token's permission list. | Require a signed org claim (HMAC over `orgId` + timestamp, 5 min skew) per request. Keep the static token as a second factor. |
| S2 | The DSL `code` step runs arbitrary JS in the API process. | `packages/integration-platform/src/dsl/interpreter.ts:637-638` (`new AsyncFunction('ctx','scope', code)`) | Code in a dynamic definition can read `ENCRYPTION_KEY`, `DATABASE_URL`, and every tenant's credentials. | Run `code` steps in `isolated-vm` with no `process`, a memory cap, and a timeout. Reject `code` steps in any definition that a partner writes. |
| S3 | One `ENCRYPTION_KEY` for all tenant credentials. | `apps/api/src/integration-platform/services/credential-vault.service.ts:93` | One key leak exposes every client's M365, Halo, and RMM secrets. | Envelope encryption: one data key per partner (and per standalone org), wrapped by a KMS or Vault Transit key. Store `keyId` on each credential version. |
| S4 | `Member` has no `@@unique([userId, organizationId])`. `Session.activeOrganizationId` has no FK. | `auth.prisma:194-244`, `auth.prisma:55-75` | Delegated access (Phase 1) creates `Member` rows automatically. Duplicates break role resolution. | Deduplicate, then add the unique constraint and the FK (`onDelete: SetNull`). |
| S5 | Platform admin bypasses every permission check. | `permission.guard.ts:119-121` | If MSP techs get platform admin as a shortcut, they get all tenants, including tenants of other partners. | Keep platform admin for Masri platform operators only. Never grant it as an MSP tech role. |
| S6 | No MFA enforcement. | `auth.server.ts` plugin list | Partner staff accounts are high-value targets. | Add the better-auth `twoFactor` plugin. Enforce 2FA for every `PartnerMember` in `PartnerGuard` and in the delegated-access reconciler. |

---

## 2. Target architecture

```
Partner (Masri)
 ├─ PartnerMember (techs, with partner roles)
 │     └─ delegated Member rows in each assigned client org (partnerMemberId set)
 ├─ PartnerConnection (HaloPSA, NinjaOne, M365 multi-tenant app)
 │     └─ ClientBinding (external client/tenant ID  <->  organizationId)
 ├─ PartnerTemplate (framework + policy + control + integration baseline)
 ├─ PsaTicketRule / PsaTicketLink / PsaOutboxEvent
 └─ Organization (client) x N   (Organization.partnerId)
```

New code locations:

| Layer | Path |
|---|---|
| Prisma | `packages/db/prisma/schema/partner.prisma`, `psa.prisma` |
| Partner RBAC | `packages/auth/src/partner-permissions.ts` |
| PSA client library | `packages/psa/` (provider interface plus `halopsa/`) |
| API | `apps/api/src/partners/`, `apps/api/src/psa/` |
| Trigger tasks | `apps/api/src/trigger/partners/`, `apps/api/src/trigger/psa/` |
| UI | `apps/app/src/app/(app)/partner/[partnerId]/...` |

---

## 3. Phase 0: Hardening (1.5 engineer-weeks)

- [ ] S1: Signed org claim for service tokens. Update the portal, trust, and trigger callers. Add guard tests for a missing claim, an expired claim, and a claim for a different org.
- [ ] S2: Move DSL `code` steps into `isolated-vm`. Add a test that reads `process.env` from a code step and expects failure.
- [ ] S3: Add envelope encryption to `CredentialVaultService`. Write a migration script that re-encrypts existing versions (dry run by default).
- [ ] S4: Deduplication script for `Member`, then a migration for the unique constraint and the FK.
- [ ] S6: Add the `twoFactor` plugin. The MSP enforcement flag ships in Phase 1.

**Exit criteria:** All new guard tests pass. The re-encryption dry run reports 0 failures on a production snapshot.

---

## 4. Phase 1: Partner tenancy (3 engineer-weeks)

### 4.1 Data model (`partner.prisma`)

```prisma
model Partner {
  id              String        @id @default(dbgenerated("generate_prefixed_cuid('ptn'::text)"))
  name            String
  slug            String        @unique
  logo            String?
  primaryColor    String?
  status          PartnerStatus @default(active)
  maxClients      Int?
  requireMfa      Boolean       @default(true)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  members       PartnerMember[]
  organizations Organization[]
  templates     PartnerTemplate[]
  connections   PartnerConnection[]
  auditLogs     PartnerAuditLog[]
}

enum PartnerStatus {
  active
  suspended
}

enum PartnerClientScope {
  all
  assigned
}

model PartnerMember {
  id          String             @id @default(dbgenerated("generate_prefixed_cuid('pmb'::text)"))
  partnerId   String
  userId      String
  role        String             // comma-separated: partner_owner, partner_admin, partner_tech, partner_viewer
  clientScope PartnerClientScope @default(assigned)
  isActive    Boolean            @default(true)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  partner           Partner               @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  user              User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientAssignments PartnerMemberClient[]
  delegatedMembers  Member[]

  @@unique([partnerId, userId])
}

model PartnerMemberClient {
  id              String   @id @default(dbgenerated("generate_prefixed_cuid('pmc'::text)"))
  partnerMemberId String
  organizationId  String
  orgRole         String   // role(s) granted inside the client org, e.g. "admin" or a custom role name
  createdAt       DateTime @default(now())

  partnerMember PartnerMember @relation(fields: [partnerMemberId], references: [id], onDelete: Cascade)
  organization  Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([partnerMemberId, organizationId])
}

model PartnerAuditLog {
  id             String   @id @default(dbgenerated("generate_prefixed_cuid('pal'::text)"))
  partnerId      String
  userId         String
  organizationId String?
  action         String
  resource       String
  resourceId     String?
  data           Json?
  createdAt      DateTime @default(now())

  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Cascade)

  @@index([partnerId, createdAt])
}
```

Changes to existing models (additive only):

- `Organization`: `partnerId String?`, `partnerAccessEnabled Boolean @default(true)`, relation to `Partner`, `@@index([partnerId])`.
- `Member`: `partnerMemberId String?` with `onDelete: Cascade`, plus the S4 unique constraint.
- `AuditLog`: `viaPartnerId String?` so the client audit log shows which MSP acted.

### 4.2 Delegated access

**Decision:** Create real `Member` rows for partner staff in each client (with `partnerMemberId` set). Do not resolve virtual members inside the guard.

**Reason:** 121 non-test files in `apps/api/src` reference `memberId`, `assigneeId`, or `createdByMemberId`. Assignments, comments, evidence review, and audit logs all need a real `Member`. Virtual members would break each of those paths.

`PartnerAccessService.reconcile({ partnerId, organizationId? })`:

1. Compute the target set: active partner members, filtered by `clientScope` and `PartnerMemberClient`, for orgs where `partnerAccessEnabled = true` and the partner is `active`.
2. Upsert `Member` rows with the mapped `orgRole`. Deactivate rows that are no longer in the target set. Keep the rows for history.
3. Skip users with no 2FA when `Partner.requireMfa = true`. Log each skip to `PartnerAuditLog`.

Run the reconciler on every relevant change (partner member CRUD, assignment change, client created, kill switch toggled). Also run it nightly in `apps/api/src/trigger/partners/reconcile-partner-access.ts`.

Default role map (overridable per assignment):

| Partner role | Default client org role |
|---|---|
| `partner_owner`, `partner_admin` | `admin` |
| `partner_tech` | custom `msp_tech` role (admin without `organization:delete`, `apiKey:*`, `secret:read`) |
| `partner_viewer` | `auditor` |

**Participation:** Extend `packages/auth/src/participation.ts` (`isOrgParticipant`) so delegated members do not count as client employees. The rule matches platform admins today: no training, no policy sign-off, no device agent, no employee counts, no portal access.

**Org switcher:** Group orgs by partner in `apps/app/src/components/organization-switcher.tsx`. Add search, because a partner can have 100+ clients.

### 4.3 Partner RBAC

`packages/auth/src/partner-permissions.ts` defines a separate `createAccessControl` statement:

| Resource | Actions |
|---|---|
| `partner` | read, update |
| `partnerMember` | create, read, update, delete |
| `client` | create, read, update, archive |
| `clientAccess` | read, update |
| `partnerTemplate` | create, read, update, delete |
| `partnerIntegration` | create, read, update, delete |
| `psa` | read, update |
| `portfolio` | read |

API rules:

- New `PartnerGuard` reads `:partnerId` from the route, loads an active `PartnerMember`, enforces MFA, and attaches `request.partnerRoles`.
- New `@RequirePartnerPermission(resource, action)` decorator. `PartnerAuditLogInterceptor` logs only when that metadata is present.
- Controller format: `@Controller({ path: 'partners/:partnerId/clients', version: '1' })`.
- Platform admin does NOT bypass `PartnerGuard`. Masri operators join the partner as `partner_owner` like everyone else.

### 4.4 Client-side controls

- Client settings shows a "Managed by {Partner}" card with the delegated users.
- The owner toggle for `partnerAccessEnabled` needs `organization:update`. Toggling it runs the reconciler right away.
- The client audit log labels partner actions with the partner name (`viaPartnerId`).

**Exit criteria:** Isolation tests pass. A `partner_tech` with `assigned` scope gets 403 on unassigned clients. Partner A gets 403 on every partner B route. The client kill switch removes access within one request.

---

## 5. Phase 2: Provisioning, templates, portfolio (4 engineer-weeks)

### 5.1 Provisioning API

Move `initializeOrganization` from the server action into `apps/api/src/organization/provisioning/organization-provisioning.service.ts`. Run it in one transaction. The existing `/setup` flow and the partner flow both call it, and the server action is then removed.

| Endpoint | Permission |
|---|---|
| `POST /v1/partners/:partnerId/clients` `{ name, website, templateId, frameworkIds?, psaClientId?, inviteOwnerEmail? }` | `client:create` |
| `POST /v1/partners/:partnerId/clients/bulk` (max 50 per call, returns a job ID) | `client:create` |
| `GET /v1/partners/:partnerId/clients` | `client:read` |
| `PATCH /v1/partners/:partnerId/clients/:orgId` | `client:update` |
| `POST /v1/partners/:partnerId/clients/:orgId/archive` | `client:archive` |

Behavior:

- `hasAccess` comes from the partner entitlement (`Partner.status = active`). This replaces the per-org `/upgrade` paywall for partner clients.
- When a template is applied, `onboardingCompleted = true`. The partner can choose to send the client wizard instead.
- Archive exports the client data, then calls the existing purge service after a 30-day hold.

### 5.2 Partner templates

`PartnerTemplate` holds a versioned JSON `definition`, validated by zod:

- `frameworkIds[]`
- Policy overrides: MSP-branded content keyed by policy template ID
- Custom controls and tasks
- Default task owners by partner role
- Integration presets: which partner connections to bind automatically
- Notification defaults

`POST /v1/partners/:partnerId/templates/:id/diff/:orgId` shows drift. A later iteration adds re-apply.

### 5.3 Portfolio dashboard

The read model `ClientComplianceSnapshot` (`organizationId`, `partnerId`, `capturedAt`) stores:

- Framework scores (JSON), and controls passing vs. total
- Failing checks, overdue tasks, and open findings
- Evidence that expires within 30 days, and unpublished policies
- Integration errors, and last activity

A nightly trigger task writes the snapshot. A debounced write also runs after each org's check run completes. This avoids N live queries per page load.

- `GET /v1/partners/:partnerId/portfolio` (filter, sort, paginate): `portfolio:read`
- UI `/partner/[partnerId]`: client table, trend chart from snapshots, and click-through that switches the active org. Follow the `responsive-ui` skill (375 / 768 / 1280 / 1920).

**Exit criteria:** Bulk provisioning of 25 clients from one template finishes without errors. The portfolio page loads in under 1 s for 200 clients.

---

## 6. Phase 3: Partner-level integrations (3 engineer-weeks)

### 6.1 Model

- `PartnerConnection` (`ptc`) has the same shape as `IntegrationConnection`, keyed by `partnerId`. `IntegrationCredentialVersion` gets a nullable `partnerConnectionId`, with a CHECK constraint that exactly one of `connectionId` and `partnerConnectionId` is set.
- `ClientBinding` (`pcb`): `partnerConnectionId`, `organizationId`, `externalId` (Halo `client_id`, NinjaOne org ID, Entra tenant ID), `externalName`, `variables Json`. Unique on `[partnerConnectionId, organizationId]` and on `[partnerConnectionId, externalId]`.

### 6.2 Runtime

- `run-org-integration-checks` resolves effective connections: the org's own connections plus the org's bound partner connections.
- `check-context.ts` gets `ctx.binding` (`externalId`, `variables`). Partner-connection checks must filter by `ctx.binding.externalId`.
- The runner loads only the binding for the org it runs for. A test asserts that a check for org A can never receive org B's binding.

### 6.3 Providers first

| Provider | Partner auth | Binding |
|---|---|---|
| Microsoft 365 / Entra / Intune | Masri multi-tenant Entra app, app-only Graph, client credentials per tenant (`https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`) | Entra tenant ID, captured by a per-client admin consent link |
| NinjaOne | One OAuth client-credentials app | NinjaOne organization ID |
| HaloPSA | See Phase 4 | Halo `client_id` (+ `site_id` in `variables`) |

Convert the dynamic `microsoft-365`, `entra-id`, and `intune` definitions to code manifests with app-only permissions and binding support. A CIPP-style GDAP + SAM token flow is a later option. Per-tenant admin consent ships first because it needs no Partner Center setup.

---

## 7. Phase 4: HaloPSA integration (7 engineer-weeks)

### 7.1 Scope and priority

| Priority | Capability |
|---|---|
| P1 | Partner-level connection, Halo client to CompAI org mapping, bulk client onboarding from Halo |
| P1 | Outbound tickets from compliance events: rules, deduplication, notes on repeat failures, auto-resolve |
| P1 | Inbound webhook and hourly reconcile for two-way ticket state |
| P2 | Evidence checks from Halo ticket data (code manifest `halopsa`) |
| P2 | Halo client contacts to CompAI people (employee sync provider `halopsa`) |
| P3 | Usage sync to Halo recurring invoices or contract items (quantities only) |
| P3 | Halo asset sync to devices (only for clients without NinjaOne) |

### 7.2 Halo API surface to build against

Confirm scope names and field names against the instance's own `/apidoc` page before coding. They vary between Halo versions.

- **App registration:** Halo > Configuration > Integrations > HaloPSA API > New application.
  - Authentication method: Client ID and Secret (Services).
  - Login type: Agent. Bind it to a dedicated agent named `CompAI Integration`, so Halo audit trails show the integration clearly.
- **Scopes (least privilege):** `read:customers read:tickets edit:tickets read:assets read:contracts read:items`. Add `edit:invoices` only for P3.
- **Token:** `POST {halo}/auth/token`, form body `grant_type=client_credentials&client_id=…&client_secret=…&scope=…`. Hosted instances also need the `tenant` query parameter. Cache the token until 60 s before `expires_in`.
- **Resources (base `{halo}/api`):**
  - Reads: `GET /Client`, `/Site`, `/Users`, `/TicketType`, `/Status`, `/Team`, `/Agent`, `/Priority`, `/Asset`, `/ClientContract`, `/Item`
  - Tickets: `GET /Tickets/{id}`, `POST /Tickets`
  - Notes: `POST /Actions`
- **Conventions:** POST bodies are arrays (`[{…}]`). List paging uses `pageinate=true&page_size=100&page_no=N` (Halo's spelling).
- **Ticket fields used:** `client_id`, `site_id`, `user_id`, `summary`, `details` (HTML), `tickettype_id`, `team_id`, `agent_id`, `priority_id`, `status_id`, `category_1`, `customfields: [{ id, value }]`.
- **Note fields used:** `ticket_id`, `note`, `outcome`, `hiddenfromuser: true`, `sendemail: false`.
- **Webhooks:** Halo > Configuration > Integrations > Webhooks. Subscribe to ticket updates. Authenticate with a custom header that holds a per-connection secret.

### 7.3 Package layout

`packages/psa/src/types.ts` defines a provider-agnostic interface, so ConnectWise and Autotask can follow later:

```ts
export interface PsaProvider {
  readonly slug: 'halopsa';
  testConnection(): Promise<PsaTestResult>;
  listClients(params: PsaPageParams): Promise<PsaPage<PsaClient>>;
  listSites(params: { clientId: string }): Promise<PsaSite[]>;
  listContacts(params: { clientId: string }): Promise<PsaContact[]>;
  getTicketMeta(): Promise<PsaTicketMeta>; // types, statuses, teams, priorities, agents
  createTicket(input: PsaTicketInput): Promise<PsaTicketRef>;
  addNote(params: { ticketId: string; note: string; isPrivate: boolean }): Promise<void>;
  updateStatus(params: { ticketId: string; statusId: string }): Promise<void>;
  getTicket(params: { ticketId: string }): Promise<PsaTicket>;
  parseWebhook(params: { headers: Record<string, string>; body: unknown }): PsaWebhookEvent | null;
}
```

`packages/psa/src/halopsa/` contains `auth.ts`, `client.ts`, `schemas.ts` (zod for every Halo response), `mappers.ts`, and `webhook.ts`. Each file stays under 300 lines.

PSA is separate from integration-platform manifests because manifests are read-only check pipelines, and PSA needs writes, an outbox, rules, and webhooks. The P2 evidence checks still ship as a code manifest (`packages/integration-platform/src/manifests/halopsa/`) that uses the partner connection and the `ClientBinding`.

### 7.4 Data model (`psa.prisma`)

The Halo client mapping reuses `ClientBinding` from Phase 3, so there is no separate mapping table.

```prisma
enum PsaTrigger {
  integration_check_failed
  finding_created
  task_overdue
  evidence_expiring
  policy_review_due
  vendor_review_due
  risk_above_threshold
  device_noncompliant
}

enum PsaResolveAction {
  add_note
  close
  none
}

enum PsaRecurrenceAction {
  add_note
  reopen
  new_ticket
}

enum PsaInboundCloseAction {
  none
  comment_on_task
  mark_task_in_review
}

model PsaTicketRule {
  id                  String                @id @default(dbgenerated("generate_prefixed_cuid('ptr'::text)"))
  partnerId           String
  partnerConnectionId String
  organizationId      String?               // null = all bound clients
  name                String
  isEnabled           Boolean               @default(true)
  trigger             PsaTrigger
  filter              Json                  // zod: minSeverity, frameworkIds, providerSlugs, taskTemplateIds, riskScoreMin
  ticketTypeId        String
  teamId              String?
  agentId             String?
  priorityId          String?
  resolvedStatusId    String?
  summaryTemplate     String
  detailsTemplate     String
  onResolve           PsaResolveAction      @default(add_note)
  onRecurrence        PsaRecurrenceAction   @default(add_note)
  inboundCloseAction  PsaInboundCloseAction @default(comment_on_task)
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt

  @@index([partnerId, trigger])
}

enum PsaLinkState {
  pending_create
  open
  resolved
  closed_externally
}

model PsaTicketLink {
  id                  String       @id @default(dbgenerated("generate_prefixed_cuid('ptl'::text)"))
  partnerConnectionId String
  organizationId      String
  ruleId              String
  entityType          String       // check | finding | task | evidence | policy | vendor | risk | device
  entityId            String
  dedupKey            String
  refToken            String       @unique // short token placed in the ticket summary, e.g. CAI-7Q2K
  psaTicketId         String?
  state               PsaLinkState @default(pending_create)
  lastEventAt         DateTime     @default(now())
  createdAt           DateTime     @default(now())

  @@unique([partnerConnectionId, dedupKey])
  @@index([organizationId])
  @@index([state])
}

enum PsaOutboxStatus {
  pending
  processing
  done
  failed
  dead
}

model PsaOutboxEvent {
  id                  String          @id @default(dbgenerated("generate_prefixed_cuid('pob'::text)"))
  partnerConnectionId String
  organizationId      String
  linkId              String
  kind                String          // create_ticket | add_note | update_status
  payload             Json
  status              PsaOutboxStatus @default(pending)
  attempts            Int             @default(0)
  nextAttemptAt       DateTime        @default(now())
  lastError           String?
  createdAt           DateTime        @default(now())

  @@index([status, nextAttemptAt])
}
```

**Dedup granularity:** One ticket per check per client (`integration_check_failed:{orgId}:{checkId}`), with the failing resources listed in the details. One ticket per finding for pentest and audit findings. This stops ticket storms when one check fails on 400 resources.

### 7.5 Event flow

1. **Hook points** (the only core-file edits):
   - `apps/api/src/trigger/integration-platform/run-task-integration-checks.ts`, after the status transition (about lines 440-547): emit `check_failed` / `check_passed`.
   - `apps/api/src/findings/finding-notifier.service.ts`: emit `finding_created`.
   - The new trigger task `psa-due-date-scan` (daily, per partner timezone) emits `task_overdue`, `evidence_expiring`, `policy_review_due`, and `vendor_review_due`.
2. **`PsaRuleEngineService`** matches the event against the partner's rules. In one transaction it upserts `PsaTicketLink` by `dedupKey` and writes a `PsaOutboxEvent`.
3. **`drain-psa-outbox`** (trigger task, per-connection queue, concurrency 5):
   - Retry with backoff (30 s, 2 m, 10 m, 1 h, 6 h), and honor `429` / `Retry-After`. Move the event to `dead` after 8 attempts and show it in the partner UI.
   - `create_ticket` writes `psaTicketId` and sets `state = open`.
   - After an ambiguous timeout, search the client's tickets for the `refToken` before a retry. This prevents duplicate tickets.
4. **Check passes again:** run the rule's `onResolve` action (default: private note "Resolved by automated check at {time}").
5. **Inbound:** `POST /v1/psa/halopsa/webhooks/:partnerConnectionId` (`@Public()`).
   - Compare the header secret in constant time, and drop replays by body hash for 24 h in `packages/kv`.
   - Map the ticket to its link, set `closed_externally`, and run `inboundCloseAction`.
6. **`reconcile-psa-tickets`** (hourly) polls the status of open links, because webhooks are best effort.

**Inbound close never marks a task done.** A closed ticket does not prove that the control passes. The next check run decides the task status.

### 7.6 Ticket content

- Summary: `[CompAI] {client} | {check or finding name} failing ({n} resources) [{refToken}]`
- Details (HTML):
  - Affected frameworks and controls
  - Failing resources table (first 50, then a count)
  - Remediation text from `IntegrationCheckResult`
  - Deep link to the CompAI task
- Pass all content through `apps/api/src/utils/redact-secrets.ts` before it enters the outbox.

### 7.7 Connection, mapping, and onboarding UI (partner console)

1. Connect form with Halo URL, tenant (hosted only), client ID, client secret, and scopes. The secret is write-only and no endpoint returns it.
2. Test the connection, then load ticket metadata into the rule editor dropdowns.
3. Import Halo clients (skip inactive clients) into a mapping table with auto-match on normalized name and website domain.
4. For each row, pick one action: map to an existing org, create a new org from a template (bulk provisioning API), or ignore.
5. The nightly `sync-psa-clients` job flags new Halo clients that have no mapping.

Endpoints (all `@RequirePartnerPermission('psa', …)`):

- `POST/GET/PATCH /v1/partners/:partnerId/psa/connections`
- `POST /v1/partners/:partnerId/psa/connections/:id/test`
- `GET /v1/partners/:partnerId/psa/connections/:id/clients`
- `PUT /v1/partners/:partnerId/psa/connections/:id/bindings`
- CRUD `/v1/partners/:partnerId/psa/rules`
- `GET /v1/partners/:partnerId/psa/links`
- `POST /v1/partners/:partnerId/psa/outbox/:id/retry`

### 7.8 Halo evidence checks (P2)

| Check | Logic | Task template |
|---|---|---|
| `halopsa_incident_response` | Security incident tickets (ticket type set in a variable) for the bound client in the last 90 days: each has a resolution note and closed within the SLA variable. Zero incidents passes, with evidence. | `TASK_TEMPLATES.incidentResponse` |
| `halopsa_access_review` | A recurring access review ticket closed in the last quarter | `TASK_TEMPLATES.accessReviewLog` |
| `halopsa_employee_access` | Joiner and leaver tickets closed within N hours | `TASK_TEMPLATES.employeeAccess` |
| `halopsa_change_management` | Change tickets have an approval recorded | New task template needed. No change-management template exists in `packages/integration-platform/src/task-mappings.ts`. Add one in the framework editor first. |

### 7.9 Billing sync (P3)

- Monthly quantities per client: active frameworks, employees in scope, devices, and pentest runs.
- `PsaBillingItemMapping(partnerConnectionId, metric, psaItemId)` maps each metric to a Halo item.
- CompAI sends quantities only. Prices and the 65% gross-margin guardrail live in Halo items. No price exists in code or config.

---

## 8. Phase 5: White-label and channels (3 engineer-weeks)

- Apply partner logo and colors to the app shell when the active org belongs to a partner.
- Send email from the partner name, with a Resend domain per partner.
- Use partner branding as the default trust portal branding.
- **Custom app domain per partner:** the current cookie domain (`.trycomp.ai`) does not cover partner domains. Each custom domain needs its own cookie scope and a `trustedOrigins` entry in better-auth. Scope this separately before you commit to it.
- **Teams and Slack channels** per partner and per client reuse the outbox pattern from 7.5.

---

## 9. Milestones

These estimates assume one engineer who knows the codebase. Real effort depends on review cycles.

| # | Milestone | Weeks | Exit criteria |
|---|---|---|---|
| M0 | Hardening S1-S6 | 1.5 | Guard tests green, re-encryption dry run clean |
| M1 | Partner model, delegated access, partner RBAC | 3 | Isolation suite green, kill switch works |
| M2 | Provisioning API and templates | 2 | 25-client bulk provisioning from a template |
| M3 | Portfolio dashboard | 2 | 200 clients load in under 1 s |
| M4 | Partner connections and bindings (M365, NinjaOne) | 3 | One NinjaOne connection runs checks for 3 clients with correct filtering |
| M5 | HaloPSA connect, mapping, bulk onboarding | 2 | Masri Halo clients imported and mapped |
| M6 | HaloPSA rules, outbox, webhook, reconcile | 3 | Failing check creates 1 ticket, repeat adds a note, pass resolves; 0 duplicates under a chaos test (kill the worker mid-send) |
| M7 | Halo evidence checks and contact sync | 2 | 3 checks mapped to tasks with evidence JSON |
| M8 | Billing sync and white-label | 3 | Monthly quantities posted to a Halo test contract |
| | **Total** | **21.5** | |

---

## 10. Testing, rollout, rollback

**Tests** (per `CLAUDE.md`, every feature ships with tests):

- API (Jest): `PartnerGuard`, the reconciler, the provisioning service, the rule engine, outbox retry and dedup, and webhook auth and replay.
- Permission tests cover `partner_admin` (write), `partner_viewer` (read-only), and an unassigned `partner_tech` (403).
- App (Vitest): partner console components with permission-gated buttons.
- Halo contract tests: record fixtures from a Halo trial instance, validate them with the zod schemas in `packages/psa/src/halopsa/schemas.ts`, and mock HTTP with `msw`.

**Rollout:**

1. Gate all partner UI and routes behind the PostHog group flag `msp-partner` (through `admin-feature-flags`) and the env var `MSP_MODE_ENABLED`.
2. Create the Masri partner. Attach existing client orgs with `apps/api/src/scripts/attach-orgs-to-partner.ts` (`--dry-run` by default, `--apply` to write).
3. Enable ticket rules for one pilot client first. Set `onResolve = add_note` for 2 weeks before you allow `close`.

**Rollback:**

- All schema changes are additive, and `partnerId` is nullable.
- Turn off the flag to hide partner routes and the UI.
- `reconcile-partner-access --revoke-all` deactivates every delegated `Member`.
- Pause the outbox with `PSA_OUTBOX_PAUSED=true`. Events stay `pending` and replay when you remove the flag.

---

## 11. Fork and license

- **Remote:** Add `upstream` (`trycompai/comp`) and merge it weekly. List every core-file touch point in `docs/plans/msp-core-touchpoints.md`, so merge conflicts stay predictable.
- **License:** The license is AGPL-3.0. Section 13 applies when clients use the modified platform over a network: Masri must offer them the modified source.

---

## 12. Decisions needed from Masri

| # | Decision | Recommendation |
|---|---|---|
| D1 | Hosting | Self-host (Docker plus self-hosted Trigger.dev v4) for data control and cost. Envelope encryption uses Vault Transit or AWS KMS. |
| D2 | Halo instance type | Tell us hosted or on-prem. It changes the token URL, the `tenant` parameter, and webhook reachability. |
| D3 | Ticket granularity | One ticket per check per client (7.4). |
| D4 | Inbound Halo close | `comment_on_task` by default. Never auto-mark tasks done (7.5). |
| D5 | Client billing | Halo recurring invoices with quantities from CompAI. Stripe only for non-MSP direct customers. |
| D6 | M365 tenant access | Per-tenant admin consent first. GDAP/SAM (CIPP model) later. |
