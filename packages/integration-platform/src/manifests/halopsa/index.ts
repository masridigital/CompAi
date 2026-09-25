/**
 * HaloPSA integration.
 *
 * The Halo API application is instance-wide (HALOPSA_* env); each org's
 * connection only maps it to a Halo client. See README.md in this folder.
 */

import type { IntegrationManifest } from '../../types';
import {
  accessReviewCheck,
  changeManagementCheck,
  employeeAccessCheck,
  incidentResponseCheck,
} from './checks';
import {
  halopsaCredentialFields,
  halopsaCredentialSchema,
  halopsaSetupInstructions,
} from './credentials';
import { halopsaHandler } from './handler';
import { syncExcludePatternsVariable, syncHaloEmployees } from './sync';
import { halopsaVariables } from './variables';

export const halopsaManifest: IntegrationManifest = {
  id: 'halopsa',
  name: 'HaloPSA',
  description:
    'Map this organization to its HaloPSA client to collect incident, access review, joiner/leaver and change evidence from Halo tickets.',
  category: 'ITSM',
  logoUrl: 'https://img.logo.dev/halopsa.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ',
  docsUrl: 'https://halopsa.com/guides/',
  isActive: true,

  auth: {
    type: 'custom',
    config: {
      description:
        'Uses the server-wide Halo API application; enter this organization’s Halo client ID.',
      credentialFields: halopsaCredentialFields,
      validationSchema: halopsaCredentialSchema,
      setupInstructions: halopsaSetupInstructions,
    },
  },

  // Requests go through the HaloPSA client (client/), not ctx.fetch.
  baseUrl: '',

  // 'sync' makes HaloPSA selectable as the org's employee sync provider. It
  // never runs unless the org explicitly picks it (employeeSyncProvider).
  capabilities: ['checks', 'sync'],
  // Once picked, Halo contacts are the directory of record for that client,
  // same as Google Workspace / Rippling / JumpCloud.
  isDirectorySource: true,
  employeeSync: {
    run: (ctx) => syncHaloEmployees({ ctx }),
    listOnlyWhenConnected: true,
  },
  variables: [...halopsaVariables, syncExcludePatternsVariable],
  checks: [incidentResponseCheck, accessReviewCheck, employeeAccessCheck, changeManagementCheck],
  handler: halopsaHandler,
};

export default halopsaManifest;

export * from './client';
export { halopsaCredentialSchema, resolveHaloConnectionMapping } from './credentials';
export type { HaloConnectionMapping } from './credentials';
export { testHaloConnection } from './handler';
export {
  meetsMinSeverity,
  parseHaloAlertSettings,
  parseHaloCheckSettings,
  parseIdList,
} from './settings';
export type { HaloAlertSettings, HaloAlertSeverity, HaloCheckSettings } from './settings';
export {
  DEFAULT_SYNC_EXCLUDE_PATTERNS,
  isExcludedHaloContact,
  mapHaloUsersToEmployees,
  parseSyncExcludePatterns,
  SYNC_EXCLUDE_PATTERNS_VARIABLE_ID,
  syncHaloEmployees,
} from './sync';
export type { HaloEmployeeMapping } from './sync';
export {
  DEFAULT_INCIDENT_SLA_HOURS,
  DEFAULT_JOINER_LEAVER_MAX_HOURS,
  DEFAULT_PRIORITY_MAP,
  HALO_ALERT_TRIGGERS,
  HALO_SEVERITIES,
} from './variables';
export type { HaloAlertTrigger } from './variables';
