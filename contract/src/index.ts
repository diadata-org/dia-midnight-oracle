export * as Oracle from "./managed/oracle/contract/index.js";
export * from "./witnesses";
// The runtime this contract is compiled for (0.21, ledger 9, Compact toolchain 0.36). Apps decode contract
// state with it, so the state is read by the same runtime as the generated `ledger()` function.
export { StateValue as ContractStateValue } from "@midnight-ntwrk/compact-runtime";
