// Global Jest setup — runs before each test suite

// Suppress winston logging during tests
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  silly: jest.fn(),
}));

// Set required env vars for config validation
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.API_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
process.env.JWT_EXPIRES_IN = '7d';
process.env.TELEGRAM_BOT_TOKEN = 'test:bot-token';
process.env.BASE_RPC_URL = 'https://sepolia.base.org';
process.env.LLM_BASE_URL = 'http://localhost:11434';
process.env.LLM_API_KEY = 'test-llm-key';
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
process.env.GOPLUS_API_URL = 'https://api.gopluslabs.io/api/v1';

afterEach(() => {
  jest.clearAllMocks();
});
