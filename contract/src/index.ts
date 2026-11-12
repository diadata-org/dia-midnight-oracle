export * as Oracle from "./managed/oracle/contract/index.js";
export * from "./witnesses";
// The runtime this contract was compiled for (0.16, ledger 8). Apps decode contract state with it, so
// the state is read by the same runtime as the generated `ledger()` function.
export { StateValue as ContractStateValue } from "@midnight-ntwrk/compact-runtime";
