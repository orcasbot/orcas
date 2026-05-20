/**
 * Tests for WalletService — wallet creation, encryption, balance queries.
 */

// Mock Prisma
const mockPrisma = {
  wallet: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};
jest.mock('../../src/lib/prisma', () => mockPrisma);

// Mock ethers — provide constructor mocks
const mockProvider = {
  getBalance: jest.fn(),
};
const mockContract = {
  balanceOf: jest.fn(),
  decimals: jest.fn(),
};
const mockWalletInstance = {
  address: '0xMOCK_WALLET_ADDRESS',
  privateKey: '0x' + 'ab'.repeat(32),
  sendTransaction: jest.fn(),
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: jest.fn(() => mockProvider),
      Wallet: Object.assign(
        jest.fn(() => mockWalletInstance),
        {
          createRandom: jest.fn(() => ({
            address: '0x' + '11'.repeat(20),
            privateKey: '0x' + 'aa'.repeat(32),
          })),
        }
      ),
      Contract: jest.fn(() => mockContract),
      formatEther: jest.fn(val => {
        // Simple conversion: assume val is bigint in wei
        if (typeof val === 'bigint') return (Number(val) / 1e18).toString();
        return '0';
      }),
      formatUnits: jest.fn((val, decimals) => {
        if (typeof val === 'bigint') return (Number(val) / Math.pow(10, Number(decimals))).toString();
        return '0';
      }),
      parseEther: jest.fn(val => BigInt(Math.floor(parseFloat(val) * 1e18))),
      parseUnits: jest.fn((val, decimals) => BigInt(Math.floor(parseFloat(val) * Math.pow(10, Number(decimals))))),
    },
  };
});

const walletService = require('../../src/services/wallet/wallet-service');

describe('WalletService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createWallet ───────────────────────────────────────────────────
  describe('createWallet', () => {
    test('creates wallet and stores encrypted key in DB', async () => {
      const dbWallet = {
        id: 'w1',
        userId: 'u1',
        address: '0x' + '11'.repeat(20),
        encryptedKey: 'iv:tag:ciphertext',
        isPrimary: true,
      };
      mockPrisma.wallet.create.mockResolvedValueOnce(dbWallet);

      const result = await walletService.createWallet('u1');

      expect(result).toEqual(dbWallet);
      expect(mockPrisma.wallet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          isPrimary: true,
          address: expect.any(String),
          encryptedKey: expect.any(String),
        }),
      });
    });

    test('encrypted key does not equal raw private key', async () => {
      let capturedEncryptedKey;
      mockPrisma.wallet.create.mockImplementation(async ({ data }) => {
        capturedEncryptedKey = data.encryptedKey;
        return { id: 'w1', ...data };
      });

      await walletService.createWallet('u1');

      // The encrypted key should have iv:tag:ciphertext format
      expect(capturedEncryptedKey).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    });
  });

  // ── getWalletWithKey ───────────────────────────────────────────────
  describe('getWalletWithKey', () => {
    test('returns null when no wallet found', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      const result = await walletService.getWalletWithKey('u1');
      expect(result).toBeNull();
    });

    test('returns wallet with decrypted private key', async () => {
      // We need a real encrypted value to decrypt. Use the encrypt function logic.
      // Since we can't easily encrypt in test, we'll create a wallet first and capture
      // the encrypted key, then use it.
      const crypto = require('crypto');
      const config = require('../../src/config');
      const key = Buffer.from(config.encryptionKey, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const testPrivKey = '0x' + 'ab'.repeat(32);
      let encrypted = cipher.update(testPrivKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag();
      const encryptedKey = iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;

      mockPrisma.wallet.findFirst.mockResolvedValueOnce({
        id: 'w1',
        userId: 'u1',
        address: '0x111',
        encryptedKey,
        isActive: true,
      });

      const result = await walletService.getWalletWithKey('u1');

      expect(result).not.toBeNull();
      expect(result.privateKey).toBe(testPrivKey);
      expect(result.id).toBe('w1');
    });
  });

  // ── getWalletAddress ───────────────────────────────────────────────
  describe('getWalletAddress', () => {
    test('returns address when wallet exists', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce({
        address: '0xABC',
      });

      const addr = await walletService.getWalletAddress('u1');
      expect(addr).toBe('0xABC');
      expect(mockPrisma.wallet.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', isActive: true },
        select: { address: true },
      });
    });

    test('returns undefined when no wallet exists', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      const addr = await walletService.getWalletAddress('u1');
      expect(addr).toBeUndefined();
    });
  });

  // ── getOrCreateWallet ──────────────────────────────────────────────
  describe('getOrCreateWallet', () => {
    test('returns existing wallet when found', async () => {
      const existing = { id: 'w1', userId: 'u1', address: '0xEXISTING' };
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(existing);

      const result = await walletService.getOrCreateWallet('u1');
      expect(result).toEqual(existing);
      // Should not call create
      expect(mockPrisma.wallet.create).not.toHaveBeenCalled();
    });

    test('creates new wallet when none exists', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);
      const newWallet = { id: 'w2', userId: 'u1', address: '0xNEW' };
      mockPrisma.wallet.create.mockResolvedValueOnce(newWallet);

      const result = await walletService.getOrCreateWallet('u1');
      expect(result).toEqual(newWallet);
      expect(mockPrisma.wallet.create).toHaveBeenCalled();
    });
  });

  // ── getBalance ─────────────────────────────────────────────────────
  describe('getBalance', () => {
    test('returns ETH balance for existing wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce({
        address: '0xWALLET',
      });
      mockProvider.getBalance.mockResolvedValueOnce(BigInt('2500000000000000000')); // 2.5 ETH

      const balance = await walletService.getBalance('u1');

      expect(balance.eth).toBeDefined();
      expect(balance.address).toBe('0xWALLET');
    });

    test('returns zero when no wallet found', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      const balance = await walletService.getBalance('u1');
      expect(balance.eth).toBe('0');
      expect(balance.usd).toBe(0);
    });
  });

  // ── getTokenBalance ────────────────────────────────────────────────
  describe('getTokenBalance', () => {
    test('returns token balance', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce({
        address: '0xWALLET',
      });
      mockContract.balanceOf.mockResolvedValueOnce(BigInt('1000000000000000000'));
      mockContract.decimals.mockResolvedValueOnce(18);

      const balance = await walletService.getTokenBalance('u1', '0xTOKEN');
      expect(balance).toBeDefined();
      expect(mockContract.balanceOf).toHaveBeenCalledWith('0xWALLET');
    });

    test('returns "0" when no wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      const balance = await walletService.getTokenBalance('u1', '0xTOKEN');
      expect(balance).toBe('0');
    });
  });

  // ── sendEth ────────────────────────────────────────────────────────
  describe('sendEth', () => {
    test('sends ETH and returns tx hash', async () => {
      // Setup: mock getWalletWithKey by mocking findFirst to return encrypted data
      const crypto = require('crypto');
      const config = require('../../src/config');
      const key = Buffer.from(config.encryptionKey, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const testPrivKey = '0x' + 'ab'.repeat(32);
      let encrypted = cipher.update(testPrivKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag();
      const encryptedKey = iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;

      mockPrisma.wallet.findFirst.mockResolvedValueOnce({
        id: 'w1',
        userId: 'u1',
        address: '0xWALLET',
        encryptedKey,
        isActive: true,
      });

      const mockReceipt = { hash: '0xTXHASH', gasUsed: BigInt(21000) };
      mockWalletInstance.sendTransaction.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValueOnce(mockReceipt),
      });

      const result = await walletService.sendEth('u1', '0xTO', '0.1');

      expect(result.txHash).toBe('0xTXHASH');
      expect(mockWalletInstance.sendTransaction).toHaveBeenCalled();
    });

    test('throws when no wallet found', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      await expect(walletService.sendEth('u1', '0xTO', '0.1')).rejects.toThrow('No wallet found');
    });
  });

  // ── sendToken ──────────────────────────────────────────────────────
  describe('sendToken', () => {
    test('throws when no wallet found', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValueOnce(null);

      await expect(walletService.sendToken('u1', '0xTO', '0xTOKEN', '100')).rejects.toThrow(
        'No wallet found'
      );
    });
  });
});
