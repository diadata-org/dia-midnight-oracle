/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { encodeCoinPublicKey, type CoinPublicKey, type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Oracle, type OraclePrivateState } from '@dia/midnight-oracle-contract';
import {
  LedgerParameters,
  nativeToken,
  type FinalizedTransaction,
  type TransactionId,
} from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
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
import { type DefaultConfiguration, type FacadeState, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { webcrypto } from 'crypto';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
  OraclePrivateStateId,
  type OracleProviders,
  type DeployedOracleContract,
  type OracleCircuits,
  type OracleValue,
  type WalletKeys,
  type WalletSecretKeys,
} from './common-types';
import { type Config, contractConfig } from './config';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
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

export const compiledOracleContract = CompiledContract.make('Oracle', Oracle.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export async function joinContract(
  providers: OracleProviders,
  contractAddress: string,
): Promise<DeployedOracleContract> {
  const oracleContract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: compiledOracleContract,
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
    compiledContract: compiledOracleContract,
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

function isSynced(state: FacadeState): boolean {
  return state.shielded.state.progress.isStrictlyComplete() && state.unshielded.progress.isStrictlyComplete();
}

/**
 * Renders a channel's replay cursor. On a fresh wallet the shielded and DUST channels stream the
 * chain's entire event history, which takes a long time on a network with real history - without the
 * cursor the log is indistinguishable from a hang.
 */
function channelProgress(progress: {
  appliedIndex: bigint;
  highestRelevantWalletIndex: bigint;
  isStrictlyComplete: () => boolean;
}): string {
  if (progress.isStrictlyComplete()) {
    return 'synced';
  }
  const { appliedIndex: applied, highestRelevantWalletIndex: target } = progress;
  // The target is only known once the first progress update arrives from the indexer.
  if (target <= 0n) {
    return `${applied}/? `.trim();
  }
  const percent = Number((applied * 1000n) / target) / 10;
  return `${applied}/${target} (${percent.toFixed(1)}%)`;
}

/** DUST pays the fees, so report it next to sync state. Throws while the DUST channel is still catching up. */
function dustBalance(state: FacadeState): bigint {
  try {
    return state.dust.balance(new Date());
  } catch {
    return 0n;
  }
}

function logSyncProgress(state: FacadeState): void {
  const unshielded = state.unshielded.progress.isStrictlyComplete()
    ? 'synced'
    : `applied ${state.unshielded.progress.appliedId}`;
  logger.info(
    `Waiting for funds. unshielded=${unshielded}, shielded=${channelProgress(state.shielded.state.progress)}, ` +
      `dust=${channelProgress(state.dust.state.progress)}, dustBalance=${dustBalance(state)}`,
  );
}

export function waitForSync(wallet: WalletFacade) {
  return Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(5_000), Rx.tap(logSyncProgress), Rx.filter(isSynced)));
}

export function waitForSyncProgress(wallet: WalletFacade) {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap(logSyncProgress),
      Rx.filter((state) => state.shielded.state.progress.isConnected || state.unshielded.progress.isConnected),
    ),
  );
}

export function waitForFunds(wallet: WalletFacade) {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap(logSyncProgress),
      Rx.filter(isSynced),
      Rx.map((state) => state.unshielded.balances[nativeToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );
}

type SerializedWalletState = {
  readonly shielded: string;
  readonly unshielded: string;
  readonly dust: string;
  readonly appliedId: string;
};

function walletConfiguration({ indexer, indexerWS, node, proofServer }: Config): DefaultConfiguration {
  return {
    networkId: getNetworkId(),
    costParameters: { feeBlocksMargin: 5 },
    relayURL: new URL(node),
    provingServerUrl: new URL(proofServer),
    indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    // A fresh wallet replays the chain's entire shielded and DUST event history. The SDK defaults
    // (size 10, timeout 1ms, spacing 4ms) apply that backlog in tiny batches behind a 4ms throttle,
    // which on a network with real history decays under GC pressure and exhausts the heap before
    // finishing. Larger batches with the inter-batch delay disabled keep memory flat and the rate up.
    batchUpdates: { size: 300_000, timeout: 100, spacing: 0 },
  };
}

async function initWallet(config: Config, keys: WalletKeys, serialized?: SerializedWalletState): Promise<WalletFacade> {
  const wallet = await WalletFacade.init({
    configuration: walletConfiguration(config),
    shielded: (c) =>
      serialized === undefined
        ? ShieldedWallet(c).startWithSecretKeys(keys.shieldedSecretKeys)
        : ShieldedWallet(c).restore(serialized.shielded),
    unshielded: (c) =>
      serialized === undefined
        ? UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(keys.unshieldedKeystore))
        : UnshieldedWallet(c).restore(serialized.unshielded),
    dust: (c) =>
      serialized === undefined
        ? DustWallet(c).startWithSecretKey(keys.dustSecretKey, LedgerParameters.initialParameters().dust)
        : DustWallet(c).restore(serialized.dust),
  });
  await wallet.start(keys.shieldedSecretKeys, keys.dustSecretKey);
  return wallet;
}

export async function buildWalletAndWaitForFunds(
  config: Config,
  keys: WalletKeys,
  filename: string,
): Promise<WalletFacade> {
  const directoryPath = process.env.SYNC_CACHE;
  let wallet: WalletFacade;
  if (directoryPath !== undefined) {
    if (fs.existsSync(`${directoryPath}/${filename}`)) {
      logger.info(`Attempting to restore state from ${directoryPath}/${filename}`);
      try {
        const serializedStream = fs.createReadStream(`${directoryPath}/${filename}`, 'utf-8');
        const serialized = await streamToString(serializedStream);
        serializedStream.on('finish', () => {
          serializedStream.close();
        });
        const stateObject = JSON.parse(serialized) as SerializedWalletState;
        wallet = await initWallet(config, keys, stateObject);
        if ((await isAnotherChain(wallet, BigInt(stateObject.appliedId))) === true) {
          logger.warn('The chain was reset, building wallet from scratch');
          wallet = await initWallet(config, keys);
        } else {
          const newState = await waitForSync(wallet);
          if (isSynced(newState)) {
            logger.info('Wallet was able to sync from restored state');
          } else {
            logger.info(`Applied id: ${stateObject.appliedId}`);
            logger.warn('Wallet was not able to sync from restored state, building wallet from scratch');
            wallet = await initWallet(config, keys);
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
        wallet = await initWallet(config, keys);
      }
    } else {
      logger.info('Wallet save file not found, building wallet from scratch');
      wallet = await initWallet(config, keys);
    }
  } else {
    logger.info('File path for save file not found, building wallet from scratch');
    wallet = await initWallet(config, keys);
  }

  const state = await Rx.firstValueFrom(wallet.state());
  logger.info(`Your wallet address is: ${keys.unshieldedKeystore.getBech32Address()}`);
  let balance = state.unshielded.balances[nativeToken().raw];
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

export async function configureProviders(wallet: WalletFacade, keys: WalletSecretKeys, config: Config) {
  const walletAndMidnightProvider = createWalletAndMidnightProvider(wallet, keys);
  const zkConfigProvider = new NodeZkConfigProvider<OracleCircuits>(contractConfig.zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof OraclePrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      privateStoragePasswordProvider: () => contractConfig.privateStoragePassword,
      accountId: contractConfig.accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
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

export async function isAnotherChain(wallet: WalletFacade, appliedId: bigint) {
  const state = await waitForSyncProgress(wallet);
  const walletAppliedId = state.unshielded.progress.appliedId;
  if (walletAppliedId < appliedId - 1n) {
    logger.info(`Your applied id is: ${walletAppliedId} restored id: ${appliedId} so it is another chain`);
    return true;
  } else {
    logger.info(`Your applied id is: ${walletAppliedId} restored id: ${appliedId} ok`);
    return false;
  }
}

export async function saveState(wallet: WalletFacade, filename: string) {
  const directoryPath = process.env.SYNC_CACHE;
  if (directoryPath !== undefined) {
    logger.info(`Saving state in ${directoryPath}/${filename}`);
    try {
      await fsAsync.mkdir(directoryPath, { recursive: true });
      const state = await Rx.firstValueFrom(wallet.state());
      const serializedState = JSON.stringify({
        shielded: await wallet.shielded.serializeState(),
        unshielded: await wallet.unshielded.serializeState(),
        dust: await wallet.dust.serializeState(),
        appliedId: state.unshielded.progress.appliedId.toString(),
      } satisfies SerializedWalletState);
      await new Promise<void>((resolve, reject) => {
        const writer = fs.createWriteStream(`${directoryPath}/${filename}`);
        writer.on('finish', () => {
          logger.info(`File '${directoryPath}/${filename}' written successfully.`);
          resolve();
        });
        writer.on('error', (err) => {
          logger.error(err);
          reject(err);
        });
        writer.write(serializedState);
        writer.end();
      });
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
