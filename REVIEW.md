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
- **File:** `apps/worker/src/routes/tokens.ts` and `apps/worker/src/routes/user-api.ts`
- **Impact:** Although tokens are hashed for authentication (`key_hash`), they are also stored in plain text in the `token_plain` column to support the `/reveal` endpoint. If the database is compromised, all user API tokens are exposed.
- **Fix Suggestion:** Do not store `token_plain`. The `/reveal` functionality should be removed. Instead, display the token to the user only once upon creation.

**2. Heavy Unbounded Aggregation Queries on Every Request**
- **File:** `apps/worker/src/routes/user-api.ts` (User Dashboard)
- **Impact:** The user dashboard endpoint (`GET /api/u/dashboard`) performs a query `LEFT JOIN usage_logs` on the `channels` table spanning the entire history (no date filter). As the `usage_logs` table grows, this will cause significant performance degradation, increased latency, and high D1 read usage. The previously reported `GET /api/models` issue is less critical as it is protected behind `adminAuth`, whereas the user dashboard is accessible to all users.
- **Fix Suggestion:**
  - Add date filters to the `LEFT JOIN usage_logs` in the user dashboard, or pre-aggregate channel statistics.

### MEDIUM

**1. N+1 SELECT Issue in Pricing Updates**
- **File:** `apps/worker/src/routes/models.ts` (`PUT /prices/:modelId`)
- **Impact:** The endpoint processes an array of prices and loops over them, executing a `SELECT` statement for each channel to fetch existing models. This N+1 query pattern can lead to performance issues and high read usage. While D1's batch limit is around 1000 statements, the N+1 SELECTs are the primary bottleneck here since this is an admin endpoint updating by channel count.
- **Fix Suggestion:** Fetch all necessary channels in a single query before the loop using an `IN` clause, then process the updates in memory before queuing the `batch` updates.

**2. Insufficient Pre-Authorization of Quota/Balance**
- **File:** `apps/worker/src/middleware/tokenAuth.ts`
- **Impact:** The `canConsumeQuota` check in the middleware validates if the token has *any* remaining quota (checking against `1`) and the user has a balance > 0. However, the system relies on post-request deduction (`total_tokens`) without locking. With concurrent requests or TOCTOU (Time-of-Check to Time-of-Use) issues, users can significantly overdraw their quota/balance, as there is no effective pre-authorization or deduction lock.
- **Fix Suggestion:** Implement a robust pre-authorization mechanism (e.g., deducting an estimated cost before the request and refunding the difference after) or strict concurrency control.

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
