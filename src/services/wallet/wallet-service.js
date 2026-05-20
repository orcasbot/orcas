/**
 * Wallet service — generates and manages Base chain wallets.
 * Private keys are encrypted with AES-256-GCM before storage.
 */

const { ethers } = require('ethers');
const crypto = require('crypto');
const prisma = require('../../lib/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  return Buffer.from(config.encryptionKey, 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

class WalletService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
  }

  /**
   * Create a new wallet for a user
   */
  async createWallet(userId) {
    const wallet = ethers.Wallet.createRandom();
    const encryptedKey = encrypt(wallet.privateKey);

    const dbWallet = await prisma.wallet.create({
      data: {
        userId,
        address: wallet.address,
        encryptedKey,
        isPrimary: true,
      },
    });

    logger.info('Wallet created', { userId, address: wallet.address });
    return dbWallet;
  }

  /**
   * Get user's wallet with decrypted private key
   */
  async getWalletWithKey(userId) {
    const wallet = await prisma.wallet.findFirst({
      where: { userId, isActive: true },
    });

    if (!wallet) return null;

    const privateKey = decrypt(wallet.encryptedKey);
    return { ...wallet, privateKey };
  }

  /**
   * Get user's wallet address
   */
  async getWalletAddress(userId) {
    const wallet = await prisma.wallet.findFirst({
      where: { userId, isActive: true },
      select: { address: true },
    });
    return wallet?.address;
  }

  /**
   * Get or create wallet for user
   */
  async getOrCreateWallet(userId) {
    let wallet = await prisma.wallet.findFirst({
      where: { userId, isActive: true },
    });

    if (!wallet) {
      wallet = await this.createWallet(userId);
    }

    return wallet;
  }

  /**
   * Get ETH balance for a user's wallet
   */
  async getBalance(userId) {
    const address = await this.getWalletAddress(userId);
    if (!address) return { eth: '0', usd: 0 };

    const balance = await this.provider.getBalance(address);
    const ethBalance = ethers.formatEther(balance);

    return { eth: ethBalance, address };
  }

  /**
   * Get ERC-20 token balance
   */
  async getTokenBalance(userId, tokenAddress) {
    const address = await this.getWalletAddress(userId);
    if (!address) return '0';

    const erc20Abi = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
    ];
    const contract = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals(),
    ]);

    return ethers.formatUnits(balance, decimals);
  }

  /**
   * Send ETH to an external address
   */
  async sendEth(userId, toAddress, amount) {
    const walletData = await this.getWalletWithKey(userId);
    if (!walletData) throw new Error('No wallet found');

    const signer = new ethers.Wallet(walletData.privateKey, this.provider);
    const tx = await signer.sendTransaction({
      to: toAddress,
      value: ethers.parseEther(amount.toString()),
    });

    const receipt = await tx.wait();
    return { txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() };
  }

  /**
   * Send ERC-20 token to an external address
   */
  async sendToken(userId, toAddress, tokenAddress, amount) {
    const walletData = await this.getWalletWithKey(userId);
    if (!walletData) throw new Error('No wallet found');

    const erc20Abi = [
      'function transfer(address, uint256) returns (bool)',
      'function decimals() view returns (uint8)',
    ];
    const signer = new ethers.Wallet(walletData.privateKey, this.provider);
    const contract = new ethers.Contract(tokenAddress, erc20Abi, signer);

    const decimals = await contract.decimals();
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    const tx = await contract.transfer(toAddress, amountWei);
    const receipt = await tx.wait();

    return { txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() };
  }
}

module.exports = new WalletService();
