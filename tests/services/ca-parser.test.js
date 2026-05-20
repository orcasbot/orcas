/**
 * Tests for CA parser — contract address extraction from messages.
 */

const { extractContractAddresses } = require('../../src/services/ca-parser');

describe('CA Parser — extractContractAddresses', () => {
  test('returns empty array for null/undefined input', () => {
    expect(extractContractAddresses(null)).toEqual([]);
    expect(extractContractAddresses(undefined)).toEqual([]);
  });

  test('returns empty array for non-string input', () => {
    expect(extractContractAddresses(123)).toEqual([]);
    expect(extractContractAddresses({})).toEqual([]);
    expect(extractContractAddresses([])).toEqual([]);
  });

  test('returns empty array for empty string', () => {
    expect(extractContractAddresses('')).toEqual([]);
  });

  test('returns empty array when no addresses found', () => {
    expect(extractContractAddresses('Hello, no addresses here!')).toEqual([]);
  });

  test('extracts a single contract address', () => {
    const addr = '0x4200000000000000000000000000000000000006';
    const result = extractContractAddresses(`Check out ${addr}`);
    expect(result).toEqual([addr]);
  });

  test('extracts multiple contract addresses', () => {
    const addr1 = '0x4200000000000000000000000000000000000006';
    const addr2 = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const result = extractContractAddresses(`WETH: ${addr1} USDC: ${addr2}`);
    expect(result).toContain(addr1);
    expect(result).toContain(addr2);
    expect(result).toHaveLength(2);
  });

  test('deduplicates identical addresses', () => {
    const addr = '0x4200000000000000000000000000000000000006';
    const result = extractContractAddresses(`${addr} and again ${addr}`);
    expect(result).toEqual([addr]);
  });

  test('handles lowercase addresses', () => {
    const addr = '0x4200000000000000000000000000000000000006';
    const result = extractContractAddresses(`lowercase: ${addr.toLowerCase()}`);
    expect(result).toHaveLength(1);
  });

  test('handles mixed case addresses', () => {
    const addr = '0xAbCdEf0123456789AbCdEf0123456789aBcDeF01';
    const result = extractContractAddresses(`mixed: ${addr}`);
    expect(result).toHaveLength(1);
  });

  test('handles addresses embedded in URLs and markdown', () => {
    const addr = '0x4200000000000000000000000000000000000006';
    const text = `[View on Basescan](https://basescan.org/address/${addr})\n\`${addr}\``;
    const result = extractContractAddresses(text);
    expect(result).toEqual([addr]);
  });

  test('does not match strings shorter than 42 chars (0x + 40 hex)', () => {
    const result = extractContractAddresses('0x1234567890abcdef');
    expect(result).toEqual([]);
  });

  test('handles a realistic Telegram message', () => {
    const addr = '0x532f27101925dd069c06489a97b8a6b1d2b0b4b2';
    const msg = `🚀 New token alert!\n\nName: BasedToken\nCA: ${addr}\nPrice: $0.0042\nLiq: $150k`;
    const result = extractContractAddresses(msg);
    expect(result).toEqual([addr]);
  });
});
