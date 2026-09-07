# ZenAPI Code Review

This document contains a comprehensive code review of the ZenAPI repository, focusing on architecture, security, reliability, performance, and documentation.

## Findings Summary

### CRITICAL

**1. Insecure Password Hashing**
- **File:** `apps/worker/src/routes/admin-users.ts`, `apps/worker/src/routes/auth.ts`, `apps/worker/src/routes/user-auth.ts`
- **Impact:** Passwords for both admin and regular users are hashed using a single round of SHA-256 (`sha256Hex(password)`). SHA-256 is extremely fast and vulnerable to dictionary attacks and rainbow tables. If the database is compromised, passwords can be easily cracked.
- **Fix Suggestion:** Replace `sha256Hex` with a strong, slow key derivation function like `bcrypt`, `Argon2`, or at minimum `PBKDF2` using `crypto.subtle.deriveBits`. Since this is a Cloudflare Worker environment, standard native modules (like `bcrypt`) are unavailable, but the Web Crypto API supports PBKDF2.

### HIGH

**1. Plain Text API Tokens Stored in Database**
- **File:** `apps/worker/src/routes/tokens.ts` (Lines generating and inserting tokens)
- **Impact:** Although tokens are hashed for authentication (`key_hash`), they are also stored in plain text in the `token_plain` column to support the `/reveal` endpoint. If the database is compromised, all user API tokens are exposed.
- **Fix Suggestion:** Do not store `token_plain`. The `/reveal` functionality should be removed. Instead, display the token to the user only once upon creation.

**2. Heavy Unbounded Aggregation Queries on Every Request**
- **File:** `apps/worker/src/routes/models.ts`
- **Impact:** The `GET /api/models` endpoint performs multiple heavy `GROUP BY` aggregations on the `usage_logs` table spanning up to 30 days of data on *every request*. As the `usage_logs` table grows, this will cause significant performance degradation, increased latency, and high D1 read usage, potentially leading to a Denial of Service.
- **Fix Suggestion:**
  - Introduce caching for the `/models` endpoint using Cloudflare KV or in-memory variables.
  - Alternatively, move the aggregation to a background cron job that populates a materialized view or summary table.

### MEDIUM

**1. Potential D1 Batch Size Limits in Pricing Updates**
- **File:** `apps/worker/src/routes/models.ts` (`PUT /prices/:modelId`)
- **Impact:** The endpoint processes an array of prices (`body.prices`) and queues them into a single `db.batch(stmts)` call. Cloudflare D1 has strict limits on the number of statements in a single batch transaction. If a user submits a large array, the batch execution will fail.
- **Fix Suggestion:** Chunk the `stmts` array into smaller batches (e.g., 50-100 statements per chunk) before calling `db.batch()`.

**2. Token Quota Enforcement Only Applied Post-Request**
- **File:** `apps/worker/src/middleware/tokenAuth.ts`
- **Impact:** The `canConsumeQuota` check in the middleware validates if the token has *any* remaining quota (checking against `1`). For streaming or large requests, the actual cost is only deducted after the request finishes in `proxy.ts`. While common for streaming APIs, this allows users to slightly overdraw their quota/balance on their final request.
- **Fix Suggestion:** Consider checking for a minimum positive balance threshold based on the requested model's pricing.

### LOW

**1. Missing Explicit Unit Tests for Core Proxy Logic**
- **File:** `apps/worker/src/routes/proxy.ts`
- **Impact:** The proxy logic handles complex fallback mechanisms, streaming usage parsing, and retry logic. Without dedicated unit tests, it is highly susceptible to regressions during refactoring.
- **Fix Suggestion:** Add unit tests covering the multi-key retry logic and streaming usage reporting in `proxy.ts`.

**2. Broad CORS Configuration**
- **File:** `apps/worker/src/index.ts`
- **Impact:** The proxy endpoints (`/v1/*` and `/anthropic/*`) allow all origins (`*`). While expected for a public API gateway, this might be undesirable for private deployments.
- **Fix Suggestion:** Allow configuring proxy CORS origins via environment variables similar to the `/api/*` endpoints.

## Positive Observations

- **Architecture:** The separation of concerns between routes, services, and middleware is clean and idiomatic for a Hono application.
- **D1 Integration:** The repository utilizes Cloudflare Workers and D1 effectively, providing a lightweight, edge-native solution.
- **Documentation:** The `README.md` is detailed and clearly outlines the architecture, deployment, and configuration options.
