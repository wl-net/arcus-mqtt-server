import aedes from 'aedes';
import type { AuthenticateError } from 'aedes';
import { createServer } from 'net';
import { createServer as createTlsServer } from 'tls';
import { readFileSync } from 'fs';
import type { Config } from './config.js';

export type Broker = InstanceType<typeof aedes>;

export interface BrokerContext {
  broker: Broker;
  close(): Promise<void>;
}

export function startBroker(config: Config): Promise<BrokerContext> {
  const broker = new aedes();

  // Optional authentication
  if (config.mqttUsername && config.mqttPassword) {
    const expectedUser = config.mqttUsername;
    const expectedPass = config.mqttPassword;

    broker.authenticate = (_client, username, password, callback) => {
      const passwordStr = password?.toString() ?? '';
      if (username === expectedUser && passwordStr === expectedPass) {
        callback(null, true);
      } else {
        const err = new Error('Bad username or password') as AuthenticateError;
        err.returnCode = 4; // BAD_USERNAME_OR_PASSWORD
        callback(err, false);
      }
    };
  }

  broker.on('client', (client) => {
    console.log(`[Broker] Client connected: ${client.id}`);
  });

  broker.on('clientDisconnect', (client) => {
    console.log(`[Broker] Client disconnected: ${client.id}`);
  });

  const useTls = config.mqttTlsCert && config.mqttTlsKey;

  const server = useTls
    ? createTlsServer(
        {
          cert: readFileSync(config.mqttTlsCert!),
          key: readFileSync(config.mqttTlsKey!),
        },
        broker.handle,
      )
    : createServer(broker.handle);

  return new Promise((resolve, reject) => {
    server.listen(config.mqttPort, () => {
      const proto = useTls ? 'MQTTS' : 'MQTT';
      console.log(`[Broker] ${proto} broker listening on port ${config.mqttPort}`);
      resolve({
        broker,
        close() {
          return new Promise<void>((res) => {
            broker.close(() => {
              server.close(() => res());
            });
          });
        },
      });
    });

    server.on('error', reject);
  });
}
