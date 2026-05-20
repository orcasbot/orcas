# Orcas Fix-All Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all bugs, complete DCA and wallet tracker features, add test coverage for the Orcas Telegram trading bot.

**Architecture:** Service-based Node.js bot (Grammy + Claude AI) on Base chain. All services follow singleton/injected pattern. Monitors poll on intervals.

**Tech Stack:** Node.js, Grammy, Prisma, PostgreSQL, ethers.js v6, Jest, Supertest

---

## Phase 1: Bug Fixes

### Task 1: Fix alpha.js Prisma model bug
**Files:** `src/bot/handlers/alpha.js`
**Issue:** Line 18 uses `prisma.alphaCaller.findMany()` but schema defines `AlphaGroup`
**Fix:** Change to `prisma.alphaGroup.findMany()`

### Task 2: Fix auto-sell notification bug
**Files:** `src/services/auto-sell.js`
**Issue:** Constructs notification text but never sends it
**Fix:** Call `this.notifications.send(userId, text)` after constructing the message

### Task 3: Fix DCA param name mismatch
**Files:** `src/services/llm/tool-executor.js`, `src/services/monitor-runner.js`
**Issue:** tool-executor stores `executedCount` and `intervalSeconds`, but monitor-runner reads `executionsCompleted` and `intervalHours`
**Fix:** Standardize on `intervalSeconds` and `executedCount` in both files

## Phase 2: DCA Feature Completion

### Task 4: Add set_dca tool definition
**Files:** `src/services/llm/tools.js`
**Add tool:** `set_dca` with params: tokenAddress, tokenSymbol, amountUsd, intervalSeconds, totalExecutions, description (optional)

### Task 5: Add list_dca tool definition
**Files:** `src/services/llm/tools.js`
**Add tool:** `list_dca` — lists active DCA plans for the user (reuse list_monitors filtered by type)

### Task 6: Update system prompt with DCA docs
**Files:** `src/services/llm/system-prompt.js`
**Add:** DCA usage examples and explanation

## Phase 3: Wallet Tracker Completion

### Task 7: Add set_wallet_tracker tool definition
**Files:** `src/services/llm/tools.js`
**Add tool:** `set_wallet_tracker` with params: walletAddress, mirror (boolean), mirrorAmountUsd (optional), description (optional)

### Task 8: Implement proper wallet tracker with mirror trading
**Files:** `src/services/monitor-runner.js` (rewrite `_checkWalletTrack`)
**Implementation:**
- Use Base RPC to fetch recent transactions for tracked wallet
- Decode DEX swap calls (0x, 1inch, Uniswap V3 router signatures)
- Detect buy/sell actions by token transfers
- If mirror=true, execute matching trade via orchestrator
- Track via ERC-20 Transfer events for position changes

### Task 9: Update system prompt with wallet tracker docs
**Files:** `src/services/llm/system-prompt.js`
**Add:** Wallet tracker + mirror trading usage examples

## Phase 4: Tests

### Task 10: Test setup + unit tests for ca-parser
**Files:** `tests/services/ca-parser.test.js`
**Tests:** CA extraction from various message formats

### Task 11: Unit tests for price-oracle
**Files:** `tests/services/price-oracle.test.js`
**Tests:** Price fetching, caching, fallback logic

### Task 12: Unit tests for token-safety
**Files:** `tests/services/token-safety.test.js`
**Tests:** Risk scoring, safe/unsafe token detection

### Task 13: Unit tests for wallet-service
**Files:** `tests/services/wallet-service.test.js`
**Tests:** Wallet creation, encryption, address derivation

### Task 14: Unit tests for trade-orchestrator
**Files:** `tests/services/trade-orchestrator.test.js`
**Tests:** Buy/sell flow, error handling, DB recording

### Task 15: Unit tests for monitor-runner (DCA + wallet tracker)
**Files:** `tests/services/monitor-runner.test.js`
**Tests:** DCA execution, wallet tracking, price alerts, limit orders

### Task 16: Integration test for tool-executor
**Files:** `tests/services/tool-executor.test.js`
**Tests:** Tool dispatch, service wiring, error propagation
