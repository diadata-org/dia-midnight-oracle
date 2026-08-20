import { DustSecretKey, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import dotenv from 'dotenv';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { type StartedDockerComposeEnvironment, type DockerComposeEnvironment } from 'testcontainers';
import { type OracleProviders, type DeployedOracleContract, type WalletKeys } from './common-types';
import { type Config, StandaloneConfig, StandaloneE2EConfig } from './config';
import * as api from './api';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import * as bip39 from 'bip39';

dotenv.config();

let logger: Logger;

/**
 * This seed gives access to tokens minted in the genesis block of a local development node - only
 * used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const DEPLOY_OR_JOIN_QUESTION = `
You can do one of the following:
  1. Deploy a new oracle contract
  2. Join an existing oracle contract
  3. Exit
Which would you like to do? `;

const MAIN_LOOP_QUESTION = `
You can do one of the following:
  1. Insert/Update oracle value
  2. Query oracle value stored at <key>
  3. Exit
Which would you like to do? `;

async function join(providers: OracleProviders, rli: Interface): Promise<DeployedOracleContract> {
  const contractAddress = await rli.question('What is the contract address (in hex)? ');
  return api.joinContract(providers, contractAddress);
}

async function deployOrJoin(providers: OracleProviders, rli: Interface): Promise<DeployedOracleContract | null> {
  while (true) {
    const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
    switch (choice) {
      case '1':
        return api.deploy(providers, {});
      case '2':
        return join(providers, rli);
      case '3':
        logger.info('Exiting...');
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
}

async function mainLoop(providers: OracleProviders, rli: Interface): Promise<void> {
  const oracleContract = await deployOrJoin(providers, rli);
  if (oracleContract === null) {
    return;
  }
  while (true) {
    const choice = await rli.question(MAIN_LOOP_QUESTION);
    let key: string;

    switch (choice) {
      case '1':
        key = await rli.question('\nKey: ');
        const value = BigInt(await rli.question('Value: '));
        const timestamp = BigInt(await rli.question('Timestamp: '));
        await api.setValue(oracleContract, key, { value, timestamp });
        break;
      case '2':
        key = await rli.question('\nKey: ');
        await api.displayOracleValue(providers, oracleContract, key);
        break;
      case '3':
        logger.info('Exiting...');
        return;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
}

/**
 * Name of the wallet sync cache file. Scoped by network and wallet so that a snapshot taken on one
 * chain (or with one seed) is never restored onto another - the standalone genesis wallet and the
 * mnemonic wallet both run on 'undeployed', so the network id alone is not enough.
 */
function cacheFilename(keys: WalletKeys): string {
  const address = String(keys.unshieldedKeystore.getBech32Address());
  return `wallet-${getNetworkId()}-${address.slice(-12)}.json`;
}

async function buildWallet(
  config: Config,
  keys: WalletKeys,
): Promise<{ wallet: WalletFacade; keys: WalletKeys; filename: string } | null> {
  if (config instanceof StandaloneConfig) {
    const genesisKeys = deriveAllKeys(Buffer.from(GENESIS_MINT_WALLET_SEED, 'hex'));
    const filename = cacheFilename(genesisKeys);
    return { wallet: await api.buildWalletAndWaitForFunds(config, genesisKeys, filename), keys: genesisKeys, filename };
  }
  const filename = cacheFilename(keys);
  return { wallet: await api.buildWalletAndWaitForFunds(config, keys, filename), keys, filename };
}

function deriveAllKeys(seed: Uint8Array): WalletKeys {
  const generatedWallet = HDWallet.fromSeed(seed);
  if (generatedWallet.type !== 'seedOk') {
    throw new Error('Error generating HDWallet');
  }
  const derivationResult = generatedWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  generatedWallet.hdWallet.clear();
  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Error deriving keys');
  }
  return {
    unshieldedKeystore: createKeystore(derivationResult.keys[Roles.NightExternal], getNetworkId()),
    shieldedSecretKeys: ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]),
    dustSecretKey: DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]),
  };
}

function mapContainerPort(env: StartedDockerComposeEnvironment, url: string, containerName: string) {
  const mappedUrl = new URL(url);
  const container = env.getContainer(containerName);

  mappedUrl.port = String(container.getFirstMappedPort());

  return mappedUrl.toString().replace(/\/+$/, '');
}

export async function run(config: Config, _logger: Logger, dockerEnv?: DockerComposeEnvironment): Promise<void> {
  logger = _logger;
  api.setLogger(_logger);
  const rli = createInterface({ input, output, terminal: true });
  let env;
  if (dockerEnv !== undefined) {
    env = await dockerEnv.up();

    if (config instanceof StandaloneConfig || config instanceof StandaloneE2EConfig) {
      config.indexer = mapContainerPort(env, config.indexer, 'midnight-dia-oracle-indexer');
      config.indexerWS = mapContainerPort(env, config.indexerWS, 'midnight-dia-oracle-indexer');
      config.node = mapContainerPort(env, config.node, 'midnight-dia-oracle-node');
      config.proofServer = mapContainerPort(env, config.proofServer, 'midnight-dia-oracle-proof-server');
    }
  }

  const mnemonic = process.env.MIDNIGHT_SEED || '';

  const keys = deriveAllKeys(bip39.mnemonicToSeedSync(mnemonic));

  const built = await buildWallet(config, keys);
  const wallet = built === null ? null : built.wallet;
  // The DUST and shielded channels keep replaying chain history after the menu appears, and no write
  // can pay its fee until DUST is spendable, so keep reporting progress while the operator is idle.
  const stopSyncReporting = wallet === null ? () => {} : api.reportSyncProgress(wallet);

  try {
    if (built !== null && wallet !== null) {
      const providers = await api.configureProviders(wallet, built.keys, config);
      await mainLoop(providers, rli);
    }
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Found error '${e.message}'`);
      logger.info('Exiting...');
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    stopSyncReporting();
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logger.error(`Error closing readline interface: ${e}`);
    } finally {
      try {
        if (built !== null && wallet !== null) {
          // Persist the sync state on a graceful shutdown, so the next run resumes from this point
          // instead of replaying the whole chain history.
          await api.saveState(wallet, built.filename);
          await wallet.stop();
        }
      } catch (e) {
        logger.error(`Error closing wallet: ${e}`);
      } finally {
        try {
          if (env !== undefined) {
            await env.down();
            logger.info('Goodbye');
          }
        } catch (e) {
          logger.error(`Error shutting down docker environment: ${e}`);
        }
      }
    }
  }
}
