import { type Resource } from '@midnight-ntwrk/wallet';
import { type Wallet } from '@midnight-ntwrk/wallet-api';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import dotenv from 'dotenv';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { type Logger } from 'pino';
import { type StartedDockerComposeEnvironment, type DockerComposeEnvironment } from 'testcontainers';
import { type OracleProviders, type DeployedOracleContract } from './common-types';
import { type Config, StandaloneConfig } from './config';
import * as api from './api';

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

async function buildWallet(config: Config, seed: string): Promise<(Wallet & Resource) | null> {
  if (config instanceof StandaloneConfig) {
    return api.buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED, '');
  }
  return api.buildWalletAndWaitForFunds(config, seed, '');
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

    if (config instanceof StandaloneConfig) {
      config.indexer = mapContainerPort(env, config.indexer, 'dia-midnight-oracle-indexer');
      config.indexerWS = mapContainerPort(env, config.indexerWS, 'dia-midnight-oracle-indexer');
      config.node = mapContainerPort(env, config.node, 'dia-midnight-oracle-node');
      config.proofServer = mapContainerPort(env, config.proofServer, 'dia-midnight-oracle-proof-server');
    }
  }

  const mnemonic = process.env.MIDNIGHT_SEED || '';
  const entropy = bip39.mnemonicToEntropy(mnemonic, wordlist);
  const seed = Buffer.from(entropy).toString('hex');

  const wallet = await buildWallet(config, seed);

  try {
    if (wallet !== null) {
      const providers = await api.configureProviders(wallet, config);
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
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logger.error(`Error closing readline interface: ${e}`);
    } finally {
      try {
        if (wallet !== null) {
          await wallet.close();
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
