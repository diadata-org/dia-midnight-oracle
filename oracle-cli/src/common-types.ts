import { Oracle, type OraclePrivateState } from '@dia/midnight-oracle-contract';
import type { Contract } from '@midnight-ntwrk/compact-js';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { Ledger9DeployedContract, Ledger9FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ZswapSecretKeys } from '@midnightntwrk/ledger-v9';
import type { WalletSeeds } from '@midnight-ntwrk/wallet-sdk-hd';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

export type OracleCircuits = Contract.ProvableCircuitId<Oracle.Contract<OraclePrivateState>>;

export const OraclePrivateStateId = 'oraclePrivateState';

export type OracleProviders = MidnightProviders<OracleCircuits, typeof OraclePrivateStateId, OraclePrivateState>;

export type OracleContract = Oracle.Contract<OraclePrivateState>;

export type DeployedOracleContract = Ledger9DeployedContract<OracleContract> | Ledger9FoundContract<OracleContract>;

export type OracleValue = Oracle.OracleValue;

// Wallet SDK 2 starts its wallets from seeds, not key objects: each ledger version derives its own
// keys from the same seed, which is what lets a wallet read the chain on both sides of the fork.
export type WalletKeys = {
  readonly seeds: WalletSeeds;
  // Ledger 9 keys of the same seeds, for the public keys the contract providers hand out.
  readonly shieldedSecretKeys: ZswapSecretKeys;
  readonly unshieldedKeystore: UnshieldedKeystore;
};
