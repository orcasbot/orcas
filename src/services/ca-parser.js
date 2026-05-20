const logger = require('../utils/logger');

const EVM_ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

function extractContractAddresses(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(EVM_ADDRESS_REGEX) || [];
  // Deduplicate
  return [...new Set(matches)];
}

module.exports = { extractContractAddresses };
