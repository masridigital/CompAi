import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClientPostureModule } from '../client-posture/client-posture.module';
import { IntegrationPlatformModule } from '../integration-platform/integration-platform.module';
import { MspChecksQuery } from './msp-checks.query';
import { MspFindingsQuery } from './msp-findings.query';
import { MspHaloTicketsQuery } from './msp-halo.query';
import { MspOverviewController } from './msp-overview.controller';
import { MspOverviewService } from './msp-overview.service';
import { MspScopeService } from './msp-scope.service';
import { MspStaffGuard } from './msp-staff.guard';
import { MspTasksQuery } from './msp-tasks.query';

@Module({
  imports: [AuthModule, ClientPostureModule, IntegrationPlatformModule],
  controllers: [MspOverviewController],
  providers: [
    MspStaffGuard,
    MspScopeService,
    MspOverviewService,
    MspTasksQuery,
    MspFindingsQuery,
    MspChecksQuery,
    MspHaloTicketsQuery,
  ],
})
export class MspOverviewModule {}
