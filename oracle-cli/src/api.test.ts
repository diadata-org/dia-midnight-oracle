import { ShieldedCoinPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NetworkId } from '@midnight-ntwrk/zswap';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  encodeCoinPublicKey: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@dia/midnight-oracle-contract', () => ({
  Oracle: {
    Contract: vi.fn(() => ({ contract: 'oracle-contract' })),
  },
  witnesses: {},
}));

vi.mock('@midnight-ntwrk/compact-runtime', () => ({
  encodeCoinPublicKey: apiMocks.encodeCoinPublicKey,
}));

describe('Midnight oracle API', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    apiMocks.encodeCoinPublicKey.mockReturnValue(new Uint8Array([1, 2, 3]));
  });

  it('decodes Bech32m wallet coin public keys before Compact encoding', async () => {
    const legacyCoinPublicKey = '11'.repeat(32);
    const bech32mCoinPublicKey = ShieldedCoinPublicKey.codec
      .encode(NetworkId.Undeployed, new ShieldedCoinPublicKey(Buffer.from(legacyCoinPublicKey, 'hex')))
      .asString();
    const changeOracleUpdater = vi.fn().mockResolvedValue({
      public: {
        blockHeight: 1,
        txId: 'tx-id',
      },
    });
    const api = await import('./api');
    api.setLogger(apiMocks.logger as never);

    await api.changeOracleUpdater(
      { callTx: { change_oracle_updater: changeOracleUpdater } } as never,
      bech32mCoinPublicKey as never,
    );

    expect(apiMocks.encodeCoinPublicKey).toHaveBeenCalledWith(legacyCoinPublicKey);
    expect(changeOracleUpdater).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]) });
  });
});
