import { Oracle, type OraclePrivateState } from '@dia/midnight-oracle-contract';
import type { ImpureCircuitId, MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';

export type OracleCircuits = ImpureCircuitId<Oracle.Contract<OraclePrivateState>>;

export const OraclePrivateStateId = 'oraclePrivateState';

export type OracleProviders = MidnightProviders<OracleCircuits, typeof OraclePrivateStateId, OraclePrivateState>;

export type OracleContract = Oracle.Contract<OraclePrivateState>;

export type DeployedOracleContract = DeployedContract<OracleContract> | FoundContract<OracleContract>;

export type OracleValue = Oracle.OracleValue;
