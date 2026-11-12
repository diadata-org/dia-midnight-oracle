import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const contractConfig = {
  privateStateStoreName: 'oracle-private-state',
  privateStoragePassword: 'Oracle-Private-State-Password-1!',
  accountId: 'oracle-cli',
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
  node = 'ws://127.0.0.1:9944';
  proofServer = 'https://lace-dev.proof-pub.stg.midnight.tools';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class StandaloneConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${new Date().toISOString()}.log`);
  indexer = 'http://127.0.0.1:8088/api/v4/graphql';
  indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
  node = 'ws://127.0.0.1:9944';
  proofServer = 'https://lace-dev.proof-pub.stg.midnight.tools';
  constructor() {
    setNetworkId('undeployed');
  }
}

export class StandaloneE2EConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'standalone-e2e', `${new Date().toISOString()}.log`);
  indexer = 'http://indexer:8088/api/v4/graphql';
  indexerWS = 'ws://indexer:8088/api/v4/graphql/ws';
  node = 'ws://node:9944';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('undeployed');
  }
}

// Midnight's own hosted endpoints (indexer/rpc.<network>.midnight.network) were shut down on
// 9 October 2026; preprod and mainnet are served by Blockfrost, with one project per network.
// The project ID is read from BLOCKFROST_PROJECT_ID (oracle-cli/.env) and never committed.
function blockfrostEndpoints(network: 'preprod' | 'mainnet') {
  const projectId = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(`Set BLOCKFROST_PROJECT_ID to a Blockfrost project ID for Midnight ${network}`);
  }
  const auth = `?project_id=${encodeURIComponent(projectId)}`;
  return {
    indexer: `https://midnight-${network}.blockfrost.io/api/v0${auth}`,
    indexerWS: `wss://midnight-${network}.blockfrost.io/api/v0/ws${auth}`,
    node: `wss://rpc.midnight-${network}.blockfrost.io${auth}`,
  };
}

export class PreprodBlockfrostConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod', `${new Date().toISOString()}.log`);
  proofServer = process.env.MIDNIGHT_PROOF_SERVER_URL || 'http://127.0.0.1:6300';
  indexer: string;
  indexerWS: string;
  node: string;
  constructor() {
    ({ indexer: this.indexer, indexerWS: this.indexerWS, node: this.node } = blockfrostEndpoints('preprod'));
    setNetworkId('preprod');
  }
}

export class MainnetConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'mainnet', `${new Date().toISOString()}.log`);
  proofServer = process.env.MIDNIGHT_PROOF_SERVER_URL || 'http://127.0.0.1:6300';
  indexer: string;
  indexerWS: string;
  node: string;
  constructor() {
    ({ indexer: this.indexer, indexerWS: this.indexerWS, node: this.node } = blockfrostEndpoints('mainnet'));
    setNetworkId('mainnet');
  }
}

// Retired Midnight-hosted preprod endpoints; kept for reference. Use PreprodBlockfrostConfig.
export class TestnetRemoteConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'testnet-remote', `${new Date().toISOString()}.log`);
  proofServer = 'http://127.0.0.1:6300';
  indexer     = 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS   = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  node        = 'wss://rpc.preprod.midnight.network';
  constructor() {
    setNetworkId('preprod');
  }
}
