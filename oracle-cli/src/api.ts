/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { encodeCoinPublicKey, type CoinPublicKey, type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Oracle, type OraclePrivateState, witnesses } from '@dia/midnight-oracle-contract';
import { nativeToken, type FinalizedTransaction, type TransactionId } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  type FinalizedTxData,
  type MidnightProvider,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { type Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { type Wallet } from '@midnight-ntwrk/wallet-api';
import { webcrypto } from 'crypto';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
  OraclePrivateStateId,
  type OracleContract,
  type OracleProviders,
  type DeployedOracleContract,
  type OracleCircuits,
  type OracleValue,
  type WalletSecretKeys,
} from './common-types';
import { type Config, contractConfig } from './config';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex, ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { getZswapNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as fsAsync from 'node:fs/promises';
import * as fs from 'node:fs';

let logger: Logger;
// Instead of setting globalThis.crypto which is read-only, we'll ensure crypto is available
// but won't try to overwrite the global property
// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function (): string {
  return this.toString();
};

export async function getOracleLedgerState(
  providers: OracleProviders,
  contractAddress: ContractAddress,
): Promise<Oracle.Ledger | null> {
  assertIsContractAddress(contractAddress);
  logger.info('Checking contract ledger state...');
  const state = await providers.publicDataProvider
    .queryContractState(contractAddress)
    .then((contractState) => (contractState != null ? Oracle.ledger(contractState.data) : null));
  return state;
}

export const oracleContractInstance: OracleContract = new Oracle.Contract(witnesses);

export async function joinContract(
  providers: OracleProviders,
  contractAddress: string,
): Promise<DeployedOracleContract> {
  const oracleContract = await findDeployedContract(providers, {
    contractAddress,
    contract: oracleContractInstance,
    privateStateId: OraclePrivateStateId,
    initialPrivateState: {},
  });
  logger.info(`Joined contract at address: ${oracleContract.deployTxData.public.contractAddress}`);
  return oracleContract;
}

export async function deploy(
  providers: OracleProviders,
  privateState: OraclePrivateState,
): Promise<DeployedOracleContract> {
  logger.info('Deploying oracle contract...');
  const oracleContract = await deployContract(providers, {
    contract: oracleContractInstance,
    privateStateId: OraclePrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Deployed contract at address: ${oracleContract.deployTxData.public.contractAddress}`);
  return oracleContract;
}

export async function setValue(
  oracleContract: DeployedOracleContract,
  key: string,
  value: OracleValue,
): Promise<FinalizedTxData> {
  logger.info('Performing oracle value update...');
  const finalizedTxData = await oracleContract.callTx.set_value(key, value);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
}

export async function setMultipleValues(
  oracleContract: DeployedOracleContract,
  batch: [string, OracleValue][],
): Promise<FinalizedTxData> {
  logger.info('Performing batch oracle update...');
  const finalizedTxData = await oracleContract.callTx.set_multiple_values(batch);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
}

export async function changeOracleUpdater(
  oracleContract: DeployedOracleContract,
  newOracleUpdater: CoinPublicKey,
): Promise<FinalizedTxData> {
  const coinPublicKey = {
    bytes: encodeCoinPublicKey(newOracleUpdater),
  };

  logger.info('Changing oracle updater public key...');
  const finalizedTxData = await oracleContract.callTx.change_oracle_updater(coinPublicKey);
  logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
  return finalizedTxData.public;
}

export async function displayOracleValue(
  providers: OracleProviders,
  oracleContract: DeployedOracleContract,
  key: string,
) {
  const contractAddress = oracleContract.deployTxData.public.contractAddress;
  const state = await getOracleLedgerState(providers, contractAddress);
  if (!state) {
    logger.info(`There is no oracle contract deployed at ${contractAddress}.`);
  } else if (state.values.member(key)) {
    const value = state.values.lookup(key);
    logger.info(`Result: ${JSON.stringify(value)}`);
  } else {
    logger.info(`Value not found: ${key}`);
  }
  return { contractAddress, state };
}

export function createWalletAndMidnightProvider(
  wallet: WalletFacade,
  keys: WalletSecretKeys,
): WalletProvider & MidnightProvider {
  return {
    getCoinPublicKey() {
      return keys.shieldedSecretKeys.coinPublicKey;
    },
    getEncryptionPublicKey() {
      return keys.shieldedSecretKeys.encryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
      const recipe = await wallet.balanceUnboundTransaction(tx, keys, { ttl });
      return wallet.finalizeRecipe(recipe);
    },
    submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      return wallet.submitTransaction(tx);
    },
  };
}

export function waitForSync(wallet: Wallet) {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`,
        );
      }),
      Rx.filter((state) => {
        // Let's allow progress only if wallet is synced fully
        return state.syncProgress !== undefined && state.syncProgress.synced;
      }),
    ),
  );
}

export function waitForSyncProgress(wallet: Wallet) {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`,
        );
      }),
      Rx.filter((state) => {
        // Let's allow progress only if syncProgress is defined
        return state.syncProgress !== undefined;
      }),
    ),
  );
}

export function waitForFunds(wallet: Wallet) {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`,
        );
      }),
      Rx.filter((state) => {
        // Let's allow progress only if wallet is synced
        return state.syncProgress?.synced === true;
      }),
      Rx.map((s) => s.balances[nativeToken()] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );
}

export async function buildWalletAndWaitForFunds(
  { indexer, indexerWS, node, proofServer }: Config,
  seed: string,
  filename: string,
): Promise<Wallet & Resource> {
  const directoryPath = process.env.SYNC_CACHE;
  let wallet: Wallet & Resource;
  if (directoryPath !== undefined) {
    if (fs.existsSync(`${directoryPath}/${filename}`)) {
      logger.info(`Attempting to restore state from ${directoryPath}/${filename}`);
      try {
        const serializedStream = fs.createReadStream(`${directoryPath}/${filename}`, 'utf-8');
        const serialized = await streamToString(serializedStream);
        serializedStream.on('finish', () => {
          serializedStream.close();
        });
        wallet = await WalletBuilder.restore(indexer, indexerWS, proofServer, node, seed, serialized, 'info');
        wallet.start();
        const stateObject = JSON.parse(serialized);
        if ((await isAnotherChain(wallet, Number(stateObject.offset))) === true) {
          logger.warn('The chain was reset, building wallet from scratch');
          wallet = await WalletBuilder.buildFromSeed(
            indexer,
            indexerWS,
            proofServer,
            node,
            seed,
            getZswapNetworkId(),
            'info',
          );
          wallet.start();
        } else {
          const newState = await waitForSync(wallet);
          // allow for situations when there's no new index in the network between runs
          if (newState.syncProgress?.synced) {
            logger.info('Wallet was able to sync from restored state');
          } else {
            logger.info(`Offset: ${stateObject.offset}`);
            logger.info(`SyncProgress.lag.applyGap: ${newState.syncProgress?.lag.applyGap}`);
            logger.info(`SyncProgress.lag.sourceGap: ${newState.syncProgress?.lag.sourceGap}`);
            logger.warn('Wallet was not able to sync from restored state, building wallet from scratch');
            wallet = await WalletBuilder.buildFromSeed(
              indexer,
              indexerWS,
              proofServer,
              node,
              seed,
              getZswapNetworkId(),
              'info',
            );
            wallet.start();
          }
        }
      } catch (error: unknown) {
        if (typeof error === 'string') {
          logger.error(error);
        } else if (error instanceof Error) {
          logger.error(error.message);
        } else {
          logger.error(error);
        }
        logger.warn('Wallet was not able to restore using the stored state, building wallet from scratch');
        wallet = await WalletBuilder.buildFromSeed(
          indexer,
          indexerWS,
          proofServer,
          node,
          seed,
          getZswapNetworkId(),
          'info',
        );
        wallet.start();
      }
    } else {
      logger.info('Wallet save file not found, building wallet from scratch');
      wallet = await WalletBuilder.buildFromSeed(
        indexer,
        indexerWS,
        proofServer,
        node,
        seed,
        getZswapNetworkId(),
        'info',
      );
      wallet.start();
    }
  } else {
    logger.info('File path for save file not found, building wallet from scratch');
    wallet = await WalletBuilder.buildFromSeed(
      indexer,
      indexerWS,
      proofServer,
      node,
      seed,
      getZswapNetworkId(),
      'info',
    );
    wallet.start();
  }

  const state = await Rx.firstValueFrom(wallet.state());
  logger.info(`Your wallet address is: ${state.address}`);
  let balance = state.balances[nativeToken()];
  if (balance === undefined || balance === 0n) {
    logger.info(`Your wallet balance is: 0`);
    logger.info(`Waiting to receive tokens...`);
    balance = await waitForFunds(wallet);
  }
  logger.info(`Your wallet balance is: ${balance}`);
  return wallet;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

export function buildFreshWallet(config: Config): Promise<Wallet & Resource> {
  return buildWalletAndWaitForFunds(config, toHex(randomBytes(32)), '');
}

export async function configureProviders(wallet: WalletFacade, keys: WalletSecretKeys, config: Config) {
  const walletAndMidnightProvider = createWalletAndMidnightProvider(wallet, keys);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof OraclePrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider: new NodeZkConfigProvider<OracleCircuits>(contractConfig.zkConfigPath),
    proofProvider: httpClientProofProvider(config.proofServer),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}

export function setLogger(_logger: Logger) {
  logger = _logger;
}

export function streamToString(stream: fs.ReadStream): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk));
    stream.on('error', (err) => {
      reject(err);
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export async function isAnotherChain(wallet: Wallet, offset: number) {
  await waitForSyncProgress(wallet);
  // Here wallet does not expose the offset block it is synced to, that is why this workaround
  const walletOffset = Number(JSON.parse(await wallet.serializeState()).offset);
  if (walletOffset < offset - 1) {
    logger.info(`Your offset offset is: ${walletOffset} restored offset: ${offset} so it is another chain`);
    return true;
  } else {
    logger.info(`Your offset offset is: ${walletOffset} restored offset: ${offset} ok`);
    return false;
  }
}

export async function saveState(wallet: Wallet, filename: string) {
  const directoryPath = process.env.SYNC_CACHE;
  if (directoryPath !== undefined) {
    logger.info(`Saving state in ${directoryPath}/${filename}`);
    try {
      await fsAsync.mkdir(directoryPath, { recursive: true });
      const serializedState = await wallet.serializeState();
      const writer = fs.createWriteStream(`${directoryPath}/${filename}`);
      writer.write(serializedState);

      writer.on('finish', function () {
        logger.info(`File '${directoryPath}/${filename}' written successfully.`);
      });

      writer.on('error', function (err) {
        logger.error(err);
      });
      writer.end();
    } catch (e) {
      if (typeof e === 'string') {
        logger.warn(e);
      } else if (e instanceof Error) {
        logger.warn(e.message);
      }
    }
  } else {
    logger.info('Not saving cache as sync cache was not defined');
  }
}
