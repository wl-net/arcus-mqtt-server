import type { Broker } from '../broker.js';
import type { ArcusDevice } from '../arcus/types.js';
import type { Config } from '../config.js';
import { matchingMappers } from '../mappers/index.js';
import { stateTopic, availabilityTopic } from './topics.js';

/** Publish the combined JSON state for a device across all matching mappers */
export function publishState(
  broker: Broker,
  config: Config,
  device: ArcusDevice,
): void {
  const matched = matchingMappers(device);
  if (matched.length === 0) return;

  // Merge state from all matching mappers into one JSON object
  let state: Record<string, unknown> = {};
  for (const mapper of matched) {
    state = { ...state, ...mapper.buildState(config, device) };
  }

  const topic = stateTopic(config, device.address);
  const payload = JSON.stringify(state);

  broker.publish(
    {
      cmd: 'publish',
      topic,
      payload: Buffer.from(payload),
      qos: 0,
      dup: false,
      retain: true,
    },
    () => {},
  );
}

/** Publish availability for a device */
export function publishAvailability(
  broker: Broker,
  config: Config,
  device: ArcusDevice,
  online: boolean,
): void {
  const topic = availabilityTopic(config, device.address);

  broker.publish(
    {
      cmd: 'publish',
      topic,
      payload: Buffer.from(online ? 'online' : 'offline'),
      qos: 0,
      dup: false,
      retain: true,
    },
    () => {},
  );
}
