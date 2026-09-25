# Cloudflare WAF Rules: compliance.masri.tech

Add these rules in Security > WAF > Custom rules, in this order. Each expression uses the Cloudflare Rules language.

## 1. Block non-API methods on the frontends

- **Action:** Block
- **Expression:**

```
(http.host in {"compliance.masri.tech" "employee.compliance.masri.tech"}
 and not http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"})
```

## 2. Halo webhook: require the Bearer header

- **Action:** Block
- **Why:** Halo sends webhooks from Azure addresses that it does not publish, so no IP allowlist is possible. This edge rule drops calls with no Bearer header. The API checks the secret itself.
- **Expression:**

```
(http.host eq "api.compliance.masri.tech"
 and starts_with(http.request.uri.path, "/v1/integrations/halopsa/webhooks/")
 and (http.request.method ne "POST"
      or not any(starts_with(http.request.headers["authorization"][*], "Bearer "))))
```

## 3. Admin API: limit to Masri networks (optional, recommended)

- **Action:** Block
- **Before you use it:** Replace `$masri_admin_ips` with a Cloudflare IP list of office and VPN egress IPs. Skip this rule if techs work from changing networks.
- **Expression:**

```
(http.host eq "api.compliance.masri.tech"
 and starts_with(http.request.uri.path, "/v1/admin/")
 and not ip.src in $masri_admin_ips)
```

## 4. Block internal routes at the edge

- **Action:** Block
- **Why:** `/v1/internal/*` routes are for Trigger.dev and service calls. Those callers reach the API from inside the stack or with service tokens. Allow only the Trigger.dev egress if it is cloud-hosted.
- **Expression:**

```
(http.host eq "api.compliance.masri.tech"
 and starts_with(http.request.uri.path, "/v1/internal/")
 and not ip.src in $trigger_egress_ips)
```

If Trigger.dev is cloud-hosted and its egress IPs are not stable, drop this rule. The routes are already protected by `INTERNAL_API_TOKEN`.

## Rate limiting rules

Add these in Security > WAF > Rate limiting rules.

| Name | Expression | Limit | Action |
|---|---|---|---|
| Login | `http.host eq "api.compliance.masri.tech" and starts_with(http.request.uri.path, "/api/auth/")` | 30 requests / 1 min / IP | Managed challenge, 10 min |
| Halo webhook | `http.host eq "api.compliance.masri.tech" and starts_with(http.request.uri.path, "/v1/integrations/halopsa/webhooks/")` | 300 requests / 1 min / IP | Block, 10 min |
| API general | `http.host eq "api.compliance.masri.tech"` | 1200 requests / 1 min / IP | Block, 1 min |

## Managed rules

- Turn on the Cloudflare Managed Ruleset and the OWASP Core Ruleset (paranoia level 1, action Block) for all three hosts.
- If you see false positives on large JSON bodies (policy editor, questionnaires), add a skip rule for `http.host eq "api.compliance.masri.tech" and http.request.uri.path contains "/v1/policies/"`. Do not turn the ruleset off.

## Validation

```bash
# Rule 2: expect 403 from Cloudflare
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.compliance.masri.tech/v1/integrations/halopsa/webhooks/x
# Expect 401 from the API (header passes the edge, secret fails in the API)
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Authorization: Bearer wrong' \
  https://api.compliance.masri.tech/v1/integrations/halopsa/webhooks/x
```
