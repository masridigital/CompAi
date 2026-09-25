/**
 * Resolves the domain for better-auth's cross-subdomain session cookie.
 *
 * Self-hosted deployments set AUTH_COOKIE_DOMAIN (e.g. `.compliance.example.com`)
 * so the session is shared by the app, API and portal hosts under that domain.
 * Without it, the hosted Comp AI domains are detected from BASE_URL, and any
 * other deployment falls back to host-only cookies.
 *
 * Keep the value as narrow as possible: every host under it receives the
 * session cookie, so never use a parent domain that also serves third-party
 * or unrelated hosts.
 */
export function getCookieDomain(): string | undefined {
  const baseUrl = process.env.BASE_URL || '';
  const configured = process.env.AUTH_COOKIE_DOMAIN?.trim();

  if (configured) {
    return validateCookieDomain({ domain: configured, baseUrl });
  }

  if (baseUrl.includes('staging.trycomp.ai')) {
    return '.staging.trycomp.ai';
  }
  if (baseUrl.includes('trycomp.ai')) {
    return '.trycomp.ai';
  }
  return undefined;
}

function validateCookieDomain({
  domain,
  baseUrl,
}: {
  domain: string;
  baseUrl: string;
}): string {
  const normalized = (domain.startsWith('.') ? domain : `.${domain}`).toLowerCase();

  // Require at least two labels so a bare TLD (".com") can never be used.
  if (normalized.split('.').filter(Boolean).length < 2) {
    throw new Error(
      `AUTH_COOKIE_DOMAIN "${domain}" is too broad. Use your deployment's domain, e.g. ".compliance.example.com".`,
    );
  }

  let apiHost: string;
  try {
    apiHost = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new Error(
      'AUTH_COOKIE_DOMAIN requires BASE_URL to be a valid URL pointing at the API.',
    );
  }

  // The browser rejects a cookie whose domain does not cover the API host,
  // which silently breaks every login. Fail at startup instead.
  if (apiHost !== normalized.slice(1) && !apiHost.endsWith(normalized)) {
    throw new Error(
      `AUTH_COOKIE_DOMAIN "${domain}" does not cover the API host "${apiHost}" from BASE_URL.`,
    );
  }

  return normalized;
}
