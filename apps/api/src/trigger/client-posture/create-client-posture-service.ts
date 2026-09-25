import { ClientPostureService } from '../../client-posture/client-posture.service';
import { FrameworksService } from '../../frameworks/frameworks.service';
import { CheckRunRepository } from '../../integration-platform/repositories/check-run.repository';
import { ConnectionRepository } from '../../integration-platform/repositories/connection.repository';
import { CheckResultsService } from '../../integration-platform/services/check-results.service';
import { TimelinesLifecycleService } from '../../timelines/timelines-lifecycle.service';
import { TimelinesService } from '../../timelines/timelines.service';

/**
 * Trigger.dev tasks run outside Nest DI, so wire the posture service (and the
 * existing services it reuses) by hand. None of these have other dependencies.
 */
export function createClientPostureService(): ClientPostureService {
  const frameworksService = new FrameworksService(
    new TimelinesService(new TimelinesLifecycleService()),
  );
  const checkResults = new CheckResultsService(
    new CheckRunRepository(),
    new ConnectionRepository(),
  );
  return new ClientPostureService(frameworksService, checkResults);
}
