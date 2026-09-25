import { Text } from '@trycompai/design-system';
import type { HaloClientRef } from './admin-org-types';

/** Bound Halo client: name (linked to Halo when possible) and id. */
export function HaloClientCell({ haloClient }: { haloClient: HaloClientRef | null }) {
  if (!haloClient) {
    return (
      <Text size="xs" variant="muted">
        Not mapped
      </Text>
    );
  }
  const label = haloClient.name ?? `Client ${haloClient.id}`;
  return (
    <div className="max-w-[200px]">
      <div className="truncate">
        {haloClient.url ? (
          <a
            href={haloClient.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {label}
          </a>
        ) : (
          <Text size="sm">{label}</Text>
        )}
      </div>
      <Text size="xs" variant="muted">
        {`#${haloClient.id}`}
      </Text>
    </div>
  );
}
