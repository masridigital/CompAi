import { Injectable } from '@nestjs/common';
import { db } from '@db';
import { ClientPostureQueryService } from '../client-posture/client-posture-query.service';
import { loadHaloClientsForOrganizations } from '../integration-platform/halopsa/halopsa-admin-client-lookup';
import {
  buildClientRow,
  computeTotals,
  type MspClientRow,
  type MspTotals,
} from './msp-overview.mapper';
import { orgIdsWithRead, type MspScope } from './msp-scope';

export interface MspOverview {
  totals: MspTotals;
  clients: MspClientRow[];
}

/** Open Halo tickets per org in ONE grouped query. */
export async function countOpenHaloTickets(
  organizationIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (organizationIds.length === 0) return result;
  const groups = await db.haloTicketLink.groupBy({
    by: ['organizationId'],
    where: { organizationId: { in: organizationIds }, state: 'open' },
    _count: { _all: true },
  });
  for (const group of groups) {
    result.set(group.organizationId, group._count._all);
  }
  return result;
}

/**
 * The master pane's client list: latest posture snapshot per org (DISTINCT ON,
 * one query), Halo client per org (one query) and open Halo tickets per org
 * (one grouped query). No per-org queries.
 */
@Injectable()
export class MspOverviewService {
  constructor(private readonly postureQuery: ClientPostureQueryService) {}

  async getOverview(scope: MspScope): Promise<MspOverview> {
    const orgIds = scope.orgs.map((org) => org.id);
    const integrationOrgIds = orgIdsWithRead({
      scope,
      resource: 'integration',
    });

    const [postureByOrg, haloClients, haloCounts] = await Promise.all([
      this.postureQuery.getLatestForOrganizations(orgIds),
      loadHaloClientsForOrganizations(integrationOrgIds),
      countOpenHaloTickets(integrationOrgIds),
    ]);

    const clients = scope.orgs.map((org) =>
      buildClientRow({
        org,
        scope,
        posture: postureByOrg.get(org.id),
        haloClient: haloClients.get(org.id),
        openHaloTickets: haloCounts.get(org.id),
      }),
    );

    return { totals: computeTotals(clients), clients };
  }
}
