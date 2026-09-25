# HaloPSA integration

> **Confirm before relying on it:** Halo field names, query parameters and scope
> names change between Halo versions. Every name used here must be confirmed
> against the tenant's live API reference at
> **https://portal.masri.tech/apidoc** before go-live.

## Credentials

The Halo API application is **instance-wide** and read from the API / worker
environment. It is never stored on a connection.

| Variable | Required | Notes |
|---|---|---|
| `HALOPSA_BASE_URL` | yes | e.g. `https://portal.masri.tech`. Resource base is `${HALOPSA_BASE_URL}/api`. |
| `HALOPSA_AUTH_URL` | no | Default `${HALOPSA_BASE_URL}/auth`. Use the authorisation server from Halo > Configuration > Integrations > Halo API > API Details. |
| `HALOPSA_TENANT` | no | Appended as `?tenant=` to the token call. |
| `HALOPSA_CLIENT_ID` / `HALOPSA_CLIENT_SECRET` | yes | Client ID and Secret (Services), agent login bound to `CompAI Integration`. |
| `HALOPSA_SCOPE` | no | Default `read:customers read:tickets edit:tickets read:assets read:teams read:agents`. Add `edit:customers` for custom-field push. |

## Client binding (platform admin only)

Every Halo call uses the instance-wide application, so the Halo client an org
is bound to decides whose Halo data it can read and write. The binding is set
**only** by a platform admin via `POST /v1/admin/halopsa/clients/:id/bind`
(or `.../create-org`) and stored in connection metadata under
`halopsaBinding: { haloClientId, haloSiteId?, haloClientName?, boundAt, boundByUserId? }`
(`binding.ts`). Checks, employee sync, alerts/outbox, posture push, the
monthly report and the digest read the mapping from there and nowhere else:
credentials and variables are customer-editable and are ignored.

The manifest has no credential fields. The generic customer endpoints refuse
`halopsa` (403 "managed by your MSP"): connection create, credential update,
metadata PATCH and variables containing binding keys (`haloClientId`,
`haloSiteId`, `haloClientName`, `halopsaBinding`). Org admins can still edit
the declared `alert_*`, evidence-check and sync variables. The connection's
credential row only holds a non-secret `{ managedBy: 'msp' }` marker (the check
runners require a credential row for custom auth). "Test connection" only
checks that the server-side HALOPSA_* app is configured.

**Data migration:** connections created before this change stored the client
id in credentials, variables or top-level metadata. Those are no longer
trusted, so every existing `halopsa` connection shows as unbound on the admin
HaloPSA page and its checks report "not bound" until a platform admin re-binds
it there. Re-binding also replaces the legacy credentials with the marker.

## Client (`client/`)

`createHaloClient()` returns a typed client (token cache with 60 s skew and
single-flight refresh, 429/5xx/network retry honouring `Retry-After`, 401
token refresh, Halo paging via `pageinate=true&page_size=100&page_no=N` and
`record_count`). Writes are array bodies:

- `POST /Tickets` `[{ client_id, site_id, user_id, summary, details, tickettype_id, team_id, agent_id, priority_id, status_id, customfields }]`
- `POST /Tickets` `[{ id, status_id }]` to change status
- `POST /Actions` `[{ ticket_id, note, outcome, hiddenfromuser, sendemail: false }]`
- `POST /Client` `[{ id, customfields: [{ name, value }] }]`
- `POST /Attachment` `[{ ticket_id, filename, data_base64 }]`

## Names to confirm on /apidoc

- Ticket search params: `client_id`, `search`, `open_only`, `closed_only`,
  `requesttype` (ticket type filter), `datesearch` / `startdate`. Results are
  also filtered client-side by client, ticket type and date, so an ignored
  param only costs extra paging.
- Ticket dates: `dateoccurred` (logged), `dateclosed` or `datecleared`
  (closed; both are read). `1900-01-01` is treated as "no date".
- Resolution note: `closure_note` / `resolution` on the ticket, otherwise an
  action whose `outcome` matches resolved/closed/completed with a note.
- Change approval: `isapproved` / `approved` on the ticket, otherwise an action
  whose `outcome` contains "approv" (excluding requested/pending/rejected).
- Lookup endpoints: `/TicketType`, `/Status`, `/Team`, `/Agent`, `/Priority`
  (priorities may be keyed by `priorityid`).
- Custom field write shape on `POST /Client`.
- Attachment upload: `POST /Attachment` `[{ ticket_id, filename, data_base64 }]`
  (`attachToTicket`, 10 MB guard). Field names are unconfirmed.

## Checks

| Check | Task template |
|---|---|
| `halopsa_incident_response` | `incidentResponse` |
| `halopsa_access_review` | `accessReviewLog` |
| `halopsa_employee_access` | `employeeAccess` |
| `halopsa_change_management` | none yet (no change-management template exists; results are recorded but no task auto-completes) |

## Employee sync (client contacts to People, off by default)

The manifest has the `sync` capability and a code `employeeSync` (`sync.ts`),
run by the API's generic `POST /v1/integrations/sync/dynamic/halopsa/employees`
endpoint and the shared `GenericEmployeeSyncService`, so import, reactivation
and deactivation rules match Google Workspace / Rippling / JumpCloud
(`isDirectorySource: true`: members in the synced email domains who are
inactive or missing in Halo are deactivated; owner/admin/auditor never are).

- It only runs when the org explicitly sets `employeeSyncProvider = 'halopsa'`
  (People > employee sync). HaloPSA is only offered there once the org has an
  active `halopsa` connection (`employeeSync.listOnlyWhenConnected`).
- Source: `GET /Users?client_id={haloClientId}&includeinactive=true`, paged.
- Mapping: email (lowercased, required), name, `active = !inactive`. Users
  without an email are skipped.
- `sync_exclude_patterns` (comma-separated, blank = defaults
  `noreply,no-reply,helpdesk,support@,info@,admin@`) drops shared/service
  mailboxes by email or name. The standard `sync_user_filter_mode` /
  `sync_excluded_emails` / `sync_included_emails` variables also apply.

Ticket type IDs, SLA hours and alert settings are connection variables (see
`variables.ts`; `parseHaloAlertSettings` / `parseHaloCheckSettings` in
`settings.ts` turn them into typed objects).
