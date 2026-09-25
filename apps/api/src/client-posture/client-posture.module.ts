import { Module } from '@nestjs/common';
import { FrameworksModule } from '../frameworks/frameworks.module';
import { IntegrationPlatformModule } from '../integration-platform/integration-platform.module';
import { ClientPostureQueryService } from './client-posture-query.service';
import { ClientPostureService } from './client-posture.service';

@Module({
  imports: [FrameworksModule, IntegrationPlatformModule],
  providers: [ClientPostureService, ClientPostureQueryService],
  exports: [ClientPostureService, ClientPostureQueryService],
})
export class ClientPostureModule {}
