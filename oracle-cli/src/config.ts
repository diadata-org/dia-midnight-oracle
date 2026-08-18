import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const contractConfig = {
  privateStateStoreName: 'oracle-private-state',
  zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'oracle'),
};

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class TestnetLocalConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'testnet-local', `${new Date().toISOString()}.log`);
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'https://lace-dev.proof-pub.stg.midnight.tools';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class StandaloneConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${new Date().toISOString()}.log`);
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  node = 'http://127.0.0.1:9944';
  proofServer = 'https://lace-dev.proof-pub.stg.midnight.tools';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class StandaloneE2EConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone-e2e', `${new Date().toISOString()}.log`);
  indexer = 'http://indexer:8088/api/v4/graphql';
  indexerWS = 'ws://indexer:8088/api/v4/graphql/ws';
  node = 'http://node:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class TestnetRemoteConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'testnet-remote', `${new Date().toISOString()}.log`);
  proofServer = 'http://127.0.0.1:6300';
  indexer     = 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS   = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  node        = 'https://rpc.preprod.midnight.network';
  constructor() {
    setNetworkId('preprod');
  }
}
