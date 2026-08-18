import { decodeCoinPublicKey } from "@midnight-ntwrk/compact-runtime";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
import { OracleValue } from "../managed/oracle/contract/index.js";
import { generateCoinPublicKey, OracleSimulator } from "./oracle-simulator";

const ORACLE_UPDATER_ERR = "failed assert: Caller is not the oracle updater";

const now = () => BigInt(Math.floor(Date.now() / 1000));

setNetworkId("undeployed");

describe("DIA Oracle smart contract", () => {
  const oracleUpdater = generateCoinPublicKey();

  const key = "NIGHT/USD";
  const value = { value: 123n, timestamp: now() };

  describe("constructor", () => {
    it("properly initializes ledger state and private state", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      const state = simulator.getLedger();
      expect(state.values.isEmpty()).toBe(true);

      const decodedPk = decodeCoinPublicKey(state.oracle_updater.bytes);
      expect(decodedPk).toEqual(oracleUpdater);

      const privateState = simulator.getPrivateState();
      expect(privateState).toEqual({});
    });
  });

  describe("get value", () => {
    it("retrieves the oracle value stored at key", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      simulator.setValue(key, value);
      expect(simulator.getValue(key)).toEqual(value);
    });

    it("returns a default value if the key does not exist", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      expect(simulator.getValue(key)).toEqual({ value: 0n, timestamp: 0n });
    });
  });

  describe("set value", () => {
    it("updates the oracle value stored at key", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      const state = simulator.setValue(key, value);
      expect(state.values.lookup(key)).toEqual(value);
    });

    it("rejects if caller is not an oracle updater", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      const unknown = generateCoinPublicKey();
      expect(() => simulator.as(unknown).setValue(key, value)).toThrow(ORACLE_UPDATER_ERR);
    });
  });

  describe("set multiple values", () => {
    const tmp = Array(10).fill(null);
    const batch = tmp.map((_, idx): [string, OracleValue] => [
      `key-${idx + 1}`,
      {
        value: BigInt(idx * 100),
        timestamp: now()
      }
    ]);

    it("performs a batch update of oracle values", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      const state = simulator.setMultipleValues(batch);

      for (const [key, val] of batch) {
        expect(state.values.lookup(key)).toEqual(val);
      }
    });

    it("rejects if caller is not an oracle updater", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      const unknown = generateCoinPublicKey();
      expect(() => simulator.as(unknown).setMultipleValues(batch)).toThrow(ORACLE_UPDATER_ERR);
    });
  });

  describe("change oracle updater", () => {
    it("updates the public key stored in ledger state", () => {
      const simulator = new OracleSimulator(oracleUpdater);

      const newUpdater = generateCoinPublicKey();
      const state = simulator.changeOracleUpdater(newUpdater);

      const decodedPk = decodeCoinPublicKey(state.oracle_updater.bytes);
      expect(decodedPk).toBe(newUpdater);
    });

    it("rejects if caller is not an oracle updater", () => {
      const simulator = new OracleSimulator(oracleUpdater);
      const unknown = generateCoinPublicKey();
      expect(() => simulator.as(unknown).changeOracleUpdater(unknown)).toThrow(ORACLE_UPDATER_ERR);
    });
  });
});
