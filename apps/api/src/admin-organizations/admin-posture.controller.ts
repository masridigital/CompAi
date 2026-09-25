import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiExcludeController,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import {
  ClientPostureQueryService,
  MAX_POSTURE_HISTORY_DAYS,
} from '../client-posture/client-posture-query.service';
import { AdminAuditLogInterceptor } from './admin-audit-log.interceptor';

const DEFAULT_HISTORY_DAYS = 30;

@ApiExcludeController()
@ApiTags('Admin - Organizations')
@Controller({ path: 'admin/organizations', version: '1' })
@UseGuards(PlatformAdminGuard)
@UseInterceptors(AdminAuditLogInterceptor)
@Throttle({ default: { ttl: 60000, limit: 30 } })
export class AdminPostureController {
  constructor(private readonly postureQuery: ClientPostureQueryService) {}

  @Get(':id/posture-history')
  @ApiOperation({
    summary: 'Client posture snapshots for an organization (platform admin)',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: `Days of history (1-${MAX_POSTURE_HISTORY_DAYS}, default ${DEFAULT_HISTORY_DAYS})`,
  })
  async history(@Param('id') id: string, @Query('days') days?: string) {
    const parsed = parseInt(days ?? `${DEFAULT_HISTORY_DAYS}`, 10);
    const data = await this.postureQuery.getHistory({
      organizationId: id,
      days: Number.isFinite(parsed) ? parsed : DEFAULT_HISTORY_DAYS,
    });
    return { data };
  }
}
