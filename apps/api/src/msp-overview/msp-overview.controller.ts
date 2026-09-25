import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { SkipOrgCheck } from '../auth/skip-org-check.decorator';
import { parseQuery } from './msp-cursor';
import { MspChecksQuery } from './msp-checks.query';
import { MspFindingsQuery, mspFindingsQuerySchema } from './msp-findings.query';
import {
  MspHaloTicketsQuery,
  mspHaloTicketsQuerySchema,
} from './msp-halo.query';
import { MspOverviewService } from './msp-overview.service';
import type { MspRequest, MspScope } from './msp-scope';
import { MspScopeService } from './msp-scope.service';
import { MspStaffGuard } from './msp-staff.guard';
import { MspTasksQuery, mspTasksQuerySchema } from './msp-tasks.query';

/**
 * MSP master pane: one cross-tenant view for platform admins and msp_staff.
 *
 * Not org-scoped (@SkipOrgCheck, like /v1/auth/me): the org set comes from
 * MspScopeService, and per-org data types are filtered by the viewer's
 * resolved member permissions (task:read, finding:read, integration:read…)
 * instead of a single @RequirePermission. Read-only; staff MFA is enforced
 * by HybridAuthGuard (the /v1/msp paths are not on the MFA allowlist) and
 * again by MspStaffGuard. Excluded from the public OpenAPI spec.
 */
@ApiExcludeController()
@ApiTags('MSP')
@Controller({ path: 'msp', version: '1' })
@UseGuards(HybridAuthGuard, MspStaffGuard)
@SkipOrgCheck()
@Throttle({ default: { ttl: 60000, limit: 60 } })
export class MspOverviewController {
  constructor(
    private readonly scopeService: MspScopeService,
    private readonly overviewService: MspOverviewService,
    private readonly tasksQuery: MspTasksQuery,
    private readonly findingsQuery: MspFindingsQuery,
    private readonly checksQuery: MspChecksQuery,
    private readonly haloQuery: MspHaloTicketsQuery,
  ) {}

  private async scopeFor(request: MspRequest): Promise<MspScope> {
    if (!request.userId || !request.mspRole) {
      throw new ForbiddenException('The MSP overview requires a staff session');
    }
    return this.scopeService.resolve({
      userId: request.userId,
      role: request.mspRole,
    });
  }

  @Get('overview')
  @ApiOperation({ summary: 'All client tenants with posture and KPI totals' })
  async overview(@Req() request: MspRequest) {
    return this.overviewService.getOverview(await this.scopeFor(request));
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Overdue or due-soon tasks across client tenants' })
  async tasks(@Req() request: MspRequest, @Query() query: unknown) {
    const parsed = parseQuery({ schema: mspTasksQuerySchema, query });
    const scope = await this.scopeFor(request);
    return this.tasksQuery.list({ scope, query: parsed });
  }

  @Get('findings')
  @ApiOperation({ summary: 'Findings across client tenants' })
  async findings(@Req() request: MspRequest, @Query() query: unknown) {
    const parsed = parseQuery({ schema: mspFindingsQuerySchema, query });
    const scope = await this.scopeFor(request);
    return this.findingsQuery.list({ scope, query: parsed });
  }

  @Get('checks/failing')
  @ApiOperation({ summary: 'Latest failing integration checks per tenant' })
  async failingChecks(@Req() request: MspRequest) {
    return this.checksQuery.listFailing(await this.scopeFor(request));
  }

  @Get('halo-tickets')
  @ApiOperation({ summary: 'HaloPSA tickets raised for client tenants' })
  async haloTickets(@Req() request: MspRequest, @Query() query: unknown) {
    const parsed = parseQuery({ schema: mspHaloTicketsQuerySchema, query });
    const scope = await this.scopeFor(request);
    return this.haloQuery.list({ scope, query: parsed });
  }
}
