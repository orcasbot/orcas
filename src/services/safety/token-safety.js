/**
 * Token safety checker — GoPlus Security API + DEXScreener data.
 */

const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Check token safety via GoPlus
 */
async function checkTokenSafety(tokenAddress) {
  try {
    const res = await axios.get(
      `${config.safety.goplusUrl}/token_security/8453`,
      {
        params: { contract_addresses: tokenAddress },
        timeout: 8000,
      }
    );

    const data = res.data.result?.[tokenAddress.toLowerCase()];
    if (!data) {
      return { success: false, error: 'Token not found in GoPlus' };
    }

    // Parse risk factors
    const risks = [];

    if (data.is_honeypot === '1') risks.push({ type: 'HONEYPOT', severity: 'CRITICAL', detail: 'Token cannot be sold' });
    if (data.is_open_source === '0') risks.push({ type: 'CLOSED_SOURCE', severity: 'HIGH', detail: 'Contract not verified' });
    if (data.is_proxy === '1') risks.push({ type: 'PROXY_CONTRACT', severity: 'MEDIUM', detail: 'Uses proxy pattern' });
    if (data.is_mintable === '1') risks.push({ type: 'MINTABLE', severity: 'HIGH', detail: 'Owner can mint new tokens' });
    if (data.can_take_back_ownership === '1') risks.push({ type: 'TAKEBACK', severity: 'HIGH', detail: 'Ownership can be reclaimed' });
    if (data.hidden_owner === '1') risks.push({ type: 'HIDDEN_OWNER', severity: 'MEDIUM', detail: 'Contract owner is hidden' });
    if (data.selfdestruct === '1') risks.push({ type: 'SELF_DESTRUCT', severity: 'HIGH', detail: 'Contract can self-destruct' });
    if (data.external_call === '1') risks.push({ type: 'EXTERNAL_CALL', severity: 'MEDIUM', detail: 'Makes external calls' });
    if (data.is_blacklisted === '1') risks.push({ type: 'BLACKLIST', severity: 'HIGH', detail: 'Has blacklist function' });
    if (data.is_whitelisted === '1') risks.push({ type: 'WHITELIST', severity: 'LOW', detail: 'Has whitelist function' });
    if (data.is_anti_whale === '1') risks.push({ type: 'ANTI_WHALE', severity: 'LOW', detail: 'Anti-whale mechanism' });
    if (data.trading_cooldown === '1') risks.push({ type: 'COOLDOWN', severity: 'LOW', detail: 'Trading cooldown enabled' });
    if (parseFloat(data.sell_tax || '0') > 0.1) risks.push({ type: 'HIGH_SELL_TAX', severity: 'HIGH', detail: `Sell tax: ${(parseFloat(data.sell_tax) * 100).toFixed(1)}%` });
    if (parseFloat(data.buy_tax || '0') > 0.1) risks.push({ type: 'HIGH_BUY_TAX', severity: 'HIGH', detail: `Buy tax: ${(parseFloat(data.buy_tax) * 100).toFixed(1)}%` });

    // Calculate risk score (0 = safe, 100 = scam)
    let riskScore = 0;
    for (const risk of risks) {
      switch (risk.severity) {
        case 'CRITICAL': riskScore += 40; break;
        case 'HIGH': riskScore += 20; break;
        case 'MEDIUM': riskScore += 10; break;
        case 'LOW': riskScore += 5; break;
      }
    }
    riskScore = Math.min(riskScore, 100);

    return {
      success: true,
      riskScore,
      risks,
      isHoneypot: data.is_honeypot === '1',
      isOpenSource: data.is_open_source === '1',
      buyTax: parseFloat(data.buy_tax || '0'),
      sellTax: parseFloat(data.sell_tax || '0'),
      holderCount: parseInt(data.holder_count || '0'),
      totalSupply: data.total_supply,
      ownerAddress: data.owner_address,
      creatorAddress: data.creator_address,
    };
  } catch (err) {
    logger.error('GoPlus safety check failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

module.exports = { checkTokenSafety };
