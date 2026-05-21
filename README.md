# DIA Midnight oracles

This repository contains DIA oracle smart contracts for Midnight network. The following oracles are implemented:

- Key/value oracle with support for batch updates (up to 10 assets)

## Prerequisites

- [Compact compiler](https://docs.midnight.network/relnotes/compact)
- [Node.js 22.x](https://nodejs.org)
- [Docker 20.0+](https://www.docker.com)
- [docker-compose v2](https://docs.docker.com/compose)

## Installing Compact compiler

1. Install the Compact command-line tool from [the compiler release page](https://docs.midnight.network/relnotes/compact) and follow the instructions regarding permissions that must be set to compile the contracts.
2. Install the Compact toolchain version used by this project:

   ```sh
   compact update 0.26.0
   ```

3. Make sure the `compact` executable is available in your shell's $PATH.

   For example, if you installed it in `$HOME/.local/bin`:

   ```sh
   export PATH=$PATH:$HOME/.local/bin
   ```

## Bulding the project

This project uses NPM workspaces to manage the dependencies. First, you'll need to run:

```sh
npm install
```

Then, compile the code in the `contract` directory:

```sh
npm run compact && npm run build
```

To run unit tests for the oracle contract:

```sh
npm run test
```

## Deployment

We'll be using Midnight network testnet to demonstrate the process of deploying oracle contracts. First, you'll need to create a Midnight wallet. We recommend using [Lace browser extension](https://docs.midnight.network/relnotes/lace). Back up your mnemonic phrase, it'll be needed for deployment later. After creating the wallet, use [Midnight test faucet](https://midnight.network/test-faucet) to request tDUST. Then, create a `.env` file in the `oracle-cli` directory with the following content:

```properties
MIDNIGHT_SEED="<YOUR 24-WORD MNEMONIC PHRASE>"
```

After that, you will need to set up the Midnight proof server. You can use `docker-compose` (see [proof-server-testnet.yml](oracle-cli/proof-server-testnet.yml)) or you can follow the instructions in the documentation [to install and launch the proof server](https://docs.midnight.network/develop/tutorial/using/proof-server):

```sh
# In the oracle-cli directory:
docker-compose -f proof-server-testnet.yml up -d
```

Next, you can run the `oracle-cli` to deploy the oracle contract:

```
npm run start-testnet-remote
```

> You can also use the CLI to join a deployed instance of the oracle and interact with it.

## Important notes

- We highly recommend to use different admin accounts for every oracle smart contract you deploy.
- Key/value oracle batch update size is fixed (10 entries), because Compact language doesn't support dynamic vectors as circuit arguments at the moment of this writing.
