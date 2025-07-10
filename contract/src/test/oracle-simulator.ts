import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  constructorContext,
  CoinPublicKey,
  encodeCoinPublicKey,
  decodeCoinPublicKey
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, type OracleValue } from "../managed/oracle/contract/index.cjs";
import crypto from "node:crypto";
import { witnesses, type OraclePrivateState } from "../witnesses";

export function generateCoinPublicKey(): CoinPublicKey {
  const buf = crypto.randomBytes(32);
  const pk = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return decodeCoinPublicKey(pk);
}

export class OracleSimulator {
  readonly contract = new Contract<OraclePrivateState>(witnesses);

  #circuitContext: CircuitContext<OraclePrivateState>;

  constructor(coinPublicKey: CoinPublicKey) {
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(constructorContext({}, coinPublicKey));

    this.#circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      originalState: currentContractState,
      transactionContext: new QueryContext(currentContractState.data, sampleContractAddress())
    };
  }

  getLedger() {
    return ledger(this.#circuitContext.transactionContext.state);
  }

  getPrivateState() {
    return this.#circuitContext.currentPrivateState;
  }

  as(coinPublicKey: CoinPublicKey) {
    const encodedPk = { bytes: encodeCoinPublicKey(coinPublicKey) };
    this.#circuitContext.currentZswapLocalState.coinPublicKey = encodedPk;
    return this;
  }

  getValue(key: string) {
    return this.contract.circuits.get_value(this.#circuitContext, key).result;
  }

  setValue(key: string, value: OracleValue) {
    this.#circuitContext = this.contract.impureCircuits.set_value(
      this.#circuitContext,
      key,
      value
    ).context;
    return this.getLedger();
  }

  setMultipleValues(batch: [string, OracleValue][]) {
    this.#circuitContext = this.contract.impureCircuits.set_multiple_values(
      this.#circuitContext,
      batch
    ).context;
    return this.getLedger();
  }

  changeOracleUpdater(newOracleUpdater: CoinPublicKey) {
    const coinPublicKey = {
      bytes: encodeCoinPublicKey(newOracleUpdater)
    };

    this.#circuitContext = this.contract.impureCircuits.change_oracle_updater(
      this.#circuitContext,
      coinPublicKey
    ).context;

    return this.getLedger();
  }
}
