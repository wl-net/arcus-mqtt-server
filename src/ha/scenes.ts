import type { Broker } from '../broker.js';
import type { ArcusClient } from '../arcus/client.js';
import type { SceneInfo } from '../arcus/types.js';
import type { Config } from '../config.js';
import { discoveryTopic } from './topics.js';

function sceneObjectId(scene: SceneInfo): string {
  // scene.id is like "{placeId}.1" — use just the number suffix
  const parts = scene.id.split('.');
  return `scene_${parts[parts.length - 1]}`;
}

function sceneTriggerTopic(config: Config, scene: SceneInfo): string {
  return `${config.deviceIdPrefix}/scene/${sceneObjectId(scene)}/fired`;
}

function sceneCommandTopic(config: Config, scene: SceneInfo): string {
  return `${config.deviceIdPrefix}/scene/${sceneObjectId(scene)}/fire`;
}

const SCENES_DEVICE = (config: Config) => ({
  identifiers: [`${config.deviceIdPrefix}_scenes`],
  name: 'Arcus Scenes',
  model: 'Scene Service',
  manufacturer: 'Arcus',
});

export function publishSceneDiscovery(broker: Broker, config: Config, scenes: SceneInfo[]): void {
  const device = SCENES_DEVICE(config);

  for (const scene of scenes) {
    const objectId = sceneObjectId(scene);

    // Device trigger (fires when scene runs on Arcus side)
    const triggerTopic = discoveryTopic(config, 'device_automation', objectId);
    broker.publish(
      {
        cmd: 'publish',
        topic: triggerTopic,
        payload: Buffer.from(JSON.stringify({
          automation_type: 'trigger',
          type: 'scene_fired',
          subtype: scene.name,
          topic: sceneTriggerTopic(config, scene),
          payload: 'fired',
          device,
        })),
        qos: 0,
        dup: false,
        retain: true,
      },
      () => {},
    );

    // Button entity (press to fire scene from HA)
    const buttonTopic = discoveryTopic(config, 'button', objectId);
    broker.publish(
      {
        cmd: 'publish',
        topic: buttonTopic,
        payload: Buffer.from(JSON.stringify({
          name: scene.name,
          unique_id: `${config.deviceIdPrefix}_${objectId}`,
          command_topic: sceneCommandTopic(config, scene),
          payload_press: 'PRESS',
          device,
        })),
        qos: 0,
        dup: false,
        retain: true,
      },
      () => {},
    );
  }
}

export function setupSceneCommandHandler(
  broker: Broker,
  config: Config,
  client: ArcusClient,
  scenes: SceneInfo[],
): void {
  const prefix = `${config.deviceIdPrefix}/scene/`;

  broker.on('publish', (packet, _client) => {
    if (!packet.topic.startsWith(prefix) || !packet.topic.endsWith('/fire')) return;
    if (packet.payload.toString() !== 'PRESS') return;

    // Extract scene object ID from topic: arcus/scene/scene_1/fire
    const objectId = packet.topic.slice(prefix.length, -'/fire'.length);
    const scene = scenes.find(s => sceneObjectId(s) === objectId);
    if (!scene) {
      console.warn(`[Scenes] Unknown scene command: ${objectId}`);
      return;
    }

    console.log(`[Scenes] Firing: ${scene.name} (${scene.address})`);
    client.fireScene(scene.address).catch(err => {
      console.error(`[Scenes] Failed to fire ${scene.name}:`, err);
    });
  });
}

export function publishSceneFired(broker: Broker, config: Config, scenes: SceneInfo[], sceneAddress: string): void {
  const scene = scenes.find(s => s.address === sceneAddress);
  if (!scene) {
    console.warn(`[Scenes] Unknown scene fired: ${sceneAddress}`);
    return;
  }

  const topic = sceneTriggerTopic(config, scene);
  console.log(`[Scenes] Fired: ${scene.name} → ${topic}`);

  broker.publish(
    {
      cmd: 'publish',
      topic,
      payload: Buffer.from('fired'),
      qos: 0,
      dup: false,
      retain: false, // triggers should not be retained
    },
    () => {},
  );
}
