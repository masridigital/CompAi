/**
 * HaloPSA connection auth.
 *
 * There are no per-org credentials: the Halo API application is instance-wide
 * (HALOPSA_* env) and the Halo client binding is set by the MSP platform admin
 * (see ./binding.ts). Customers cannot create or edit halopsa connections, so
 * the connect dialog only shows these instructions.
 */
export const halopsaAuthDescription = 'Managed by your MSP. No credentials are needed here.';

export const halopsaSetupInstructions = `This integration is managed by your MSP.

Your MSP administrator connects this organization to its HaloPSA client from the admin HaloPSA page. Once connected you can tune the alert settings (which events raise Halo tickets, ticket type, team and priorities) and the evidence check settings here.

Contact your MSP if HaloPSA should be connected or its client mapping changed.`;
