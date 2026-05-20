/**
 * Base chain swap service — DEX aggregation via 0x Protocol + 1inch fallback.
 * All swaps happen on Base (chainId 8453).
 */

const { ethers } = require('ethers');
const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

// Uniswap V3 SwapRouter02 ABI (minimal)
const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory)',
];

const WETH_BASE = '0x4200000000000000000000000000000000000006';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

class BaseSwapService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.base.rpcUrl);
    this.zeroxConfig = config.swap.zerox;
    this.oneinchConfig = config.swap.oneinch;
  }

  /**
   * Get a swap quote from 0x Protocol
   */
  async getQuote({ tokenIn, tokenOut, amountIn, slippageBps, takerAddress }) {
    const slippagePct = (slippageBps || 500) / 100;

    try {
      const params = {
        chainId: 8453,
        sellToken: tokenIn,
        buyToken: tokenOut,
        sellAmount: amountIn,
        slippagePercentage: slippagePct / 100,
        taker: takerAddress,
      };

      const headers = {};
      if (this.zeroxConfig.apiKey) {
        headers['0x-api-key'] = this.zeroxConfig.apiKey;
      }

      const response = await axios.get(`${this.zeroxConfig.apiUrl}/swap/allowance-holder/quote`, {
        params,
        headers,
        timeout: 10000,
      });

      return {
        success: true,
        to: response.data.transaction.to,
        data: response.data.transaction.data,
        value: response.data.transaction.value || '0',
        gasLimit: response.data.transaction.gas,
        buyAmount: response.data.buyAmount,
        sellAmount: response.data.sellAmount,
        price: response.data.price,
        sources: response.data.sources,
        gasPrice: response.data.gasPrice,
      };
    } catch (err) {
      logger.warn('0x quote failed, trying 1inch fallback', { error: err.message });
      return this.getQuote1inch({ tokenIn, tokenOut, amountIn, slippageBps, takerAddress });
    }
  }

  /**
   * Fallback: 1inch swap quote
   */
  async getQuote1inch({ tokenIn, tokenOut, amountIn, slippageBps, takerAddress }) {
    const slippagePct = (slippageBps || 500) / 100;

    try {
      const url = `${this.oneinchConfig.apiUrl}/swap/v6.0/8453/swap`;
      const params = {
        src: tokenIn,
        dst: tokenOut,
        amount: amountIn,
        slippage: slippagePct,
        from: takerAddress,
      };

      const headers = {};
      if (this.oneinchConfig.apiKey) {
        headers['Authorization'] = `Bearer ${this.oneinchConfig.apiKey}`;
      }

      const response = await axios.get(url, { params, headers, timeout: 10000 });

      return {
        success: true,
        to: response.data.tx.to,
        data: response.data.tx.data,
        value: response.data.tx.value || '0',
        gasLimit: response.data.tx.gas,
        buyAmount: response.data.toAmount,
        sellAmount: amountIn,
        price: null,
        sources: null,
      };
    } catch (err) {
      logger.error('1inch quote also failed', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Execute a swap transaction
   */
  async executeSwap({ wallet, tokenIn, tokenOut, amountIn, slippageBps }) {
    const takerAddress = wallet.address;

    // Get quote
    const quote = await this.getQuote({
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps,
      takerAddress,
    });

    if (!quote.success) {
      return { success: false, error: quote.error };
    }

    try {
      // Build transaction
      const tx = {
        to: quote.to,
        data: quote.data,
        value: BigInt(quote.value),
        gasLimit: BigInt(quote.gasLimit || 500000),
      };

      // Send transaction
      const signer = new ethers.Wallet(wallet.privateKey, this.provider);
      const txResponse = await signer.sendTransaction(tx);
      const receipt = await txResponse.wait();

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice.toString(),
        buyAmount: quote.buyAmount,
      };
    } catch (err) {
      logger.error('Swap execution failed', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Buy token with ETH
   */
  async buyWithEth({ wallet, tokenAddress, ethAmount, slippageBps }) {
    const amountInWei = ethers.parseEther(ethAmount.toString());

    return this.executeSwap({
      wallet,
      tokenIn: WETH_BASE,
      tokenOut: tokenAddress,
      amountIn: amountInWei.toString(),
      slippageBps,
    });
  }

  /**
   * Buy token with USDC
   */
  async buyWithUsdc({ wallet, tokenAddress, usdcAmount, slippageBps }) {
    const amountInWei = ethers.parseUnits(usdcAmount.toString(), 6); // USDC = 6 decimals

    return this.executeSwap({
      wallet,
      tokenIn: USDC_BASE,
      tokenOut: tokenAddress,
      amountIn: amountInWei.toString(),
      slippageBps,
    });
  }

  /**
   * Sell token for ETH
   */
  async sellForEth({ wallet, tokenAddress, tokenAmount, tokenDecimals, slippageBps }) {
    const amountInWei = ethers.parseUnits(tokenAmount.toString(), tokenDecimals);

    return this.executeSwap({
      wallet,
      tokenIn: tokenAddress,
      tokenOut: WETH_BASE,
      amountIn: amountInWei.toString(),
      slippageBps,
    });
  }

  /**
   * Get token balance for a wallet
   */
  async getTokenBalance(walletAddress, tokenAddress) {
    if (tokenAddress === 'native' || tokenAddress === WETH_BASE) {
      const balance = await this.provider.getBalance(walletAddress);
      return ethers.formatEther(balance);
    }

    const erc20Abi = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
    ];
    const contract = new ethers.Contract(tokenAddress, erc20Abi, this.provider);
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(walletAddress),
      contract.decimals(),
    ]);

    return ethers.formatUnits(balance, decimals);
  }

  /**
   * Get ETH balance
   */
  async getEthBalance(walletAddress) {
    const balance = await this.provider.getBalance(walletAddress);
    return ethers.formatEther(balance);
  }

  /**
   * Get gas price
   */
  async getGasPrice() {
    const feeData = await this.provider.getFeeData();
    return {
      gasPrice: feeData.gasPrice?.toString(),
      maxFeePerGas: feeData.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
    };
  }
}

module.exports = new BaseSwapService();
