# Full Backend Audit — 2026-09-24

| Field       | Value                                                                   |
| ----------- | ----------------------------------------------------------------------- |
| Commit      | `f1e895a` (`main`, after #18)                                           |
| Scope       | Every module under `src/`, the container image, and the deployed stack  |
| Method      | `docs/prompts/audit-prompt.md`                                          |
| Supersedes  | [2026-09-24 backend audit](./2026-09-24-backend-audit.md) (kernel only) |
| Code change | None. Diagnosis only; fixes land in their own pull requests             |

## 0. Scope and honest limitations

- All ~7,100 lines of non-test source were read, together with the specs of every module,
  `Dockerfile`, `.github/workflows/*`, and the host deployment script and security group in
  `adh-shop-infra`.
- Findings marked **Confirmed** were reproduced against production
  (`https://adh-api.alfredo-dominguez.dev`) or proven from the code. Findings marked
  **Potential risk** depend on conditions that could not be triggered safely.
- **Authentication and authorization are not applicable.** The brief defines no user
  accounts. Resources are addressed by random UUIDs, so possession of the id is the only
  credential. This is assessed as a design constraint (K-9), not as a missing feature.
- Not verifiable with the available code: the gateway's retry policy for events, and
  whether a card payment can stay `PENDING` at the gateway indefinitely.

## 1. Architecture as it exists today

Hexagonal architecture with Railway Oriented Programming, split into two bounded contexts
and a shared kernel:

```
src/
  shared/      Result/ResultAsync, DomainError, clock and id ports;
               config, logging, health, DynamoDB client, rate limiting, idempotency
  contexts/
    catalog/   products, prices, stock, signed image URLs
    checkout/  quotes, transactions, customers, payments, settlement, deliveries, expiry
```

- **Entry point**: `main.ts` builds a Nest/Express app with helmet, compression, CORS, a
  global `ValidationPipe` (whitelist + forbid unknown, 422), a global exception filter, URI
  versioning under `/api/v1`, and Swagger at `/api/docs`.
- **Dependency rule** enforced by ESLint: domain files cannot import Nest, the AWS SDK,
  infrastructure or application code. Use cases are plain classes wired by hand in the
  module files.
- **Persistence**: one DynamoDB table (single-table design) and one sparse index `GSI1`.
  All invariant-bearing writes are conditional; settlement is a `TransactWriteItems`.
- **External services**: the payment gateway (REST, zod-validated responses), CloudFront
  signed URLs for images, ElastiCache Valkey (IAM auth) for rate-limit counters.
- **Background work**: `ReservationSweeper`, an in-process timer running
  `ExpireReservations` every 60 s.
- **Runtime**: Node 24 Alpine image, non-root, `dumb-init`, on one EC2 host behind nginx
  and Cloudflare, blue/green deployed by `deploy.sh` through SSM.

Data model (single table):

| Entity          | PK                         | SK          | GSI1 (PK / SK)                                  |
| --------------- | -------------------------- | ----------- | ----------------------------------------------- |
| Product         | `PRODUCT#<id>`             | `#META`     | `PRODUCT` / `<id>`                              |
| Customer        | `CUSTOMER#<sha256(email)>` | `#PROFILE`  | —                                               |
| Transaction     | `TRANSACTION#<uuid>`       | `#META`     | `PENDING_TRANSACTION` / deadline, while PENDING |
| Delivery        | `TRANSACTION#<uuid>`       | `#DELIVERY` | —                                               |
| Idempotency key | `IDEMPOTENCY#<key>`        | `#REQUEST`  | — (TTL `expiresAt`)                             |

## 2. Module inventory

| Unit | Module                     | Files (non-test) | Verdict  |
| ---- | -------------------------- | ---------------: | -------- |
| S    | Shared kernel and platform |               28 | 8.2 / 10 |
| C    | Catalog                    |               15 | 8.4 / 10 |
| K    | Checkout                   |               37 | 8.4 / 10 |
| P    | Production and deployment  |    image + infra | 6.5 / 10 |

---

# MODULE: Shared kernel and platform (S)

**Responsibility** — the railway types, the error model and its HTTP mapping, validated
configuration, structured logging with request ids, health probes, the DynamoDB client,
distributed rate limiting, and the idempotency interceptor.

**Grade** — 8.2 / 10

| Category            | Grade |
| ------------------- | ----: |
| NestJS architecture |  9/10 |
| Code                |  9/10 |
| TypeScript          |  8/10 |
| API                 |  7/10 |
| Security            |  6/10 |
| Auth                |   n/a |
| Database            |  8/10 |
| Performance         |  9/10 |
| Errors              |  9/10 |
| Testing             |  8/10 |
| Maintainability     |  8/10 |
| Scalability         |  8/10 |

**What is good**

- One error envelope for every failure (`AllExceptionsFilter`), with the cause chain logged
  server-side and never returned. 5xx responses are deliberately opaque.
- Configuration is parsed once with zod and fails the boot listing every invalid key.
  Production refuses to start without CDN settings. No `process.env` reads outside config.
- The idempotency interceptor binds a key to method, path and body, stores only successes,
  expires keys through the table TTL, and frees keys held by a crashed process after 60 s.
  Verified in production: replay, reuse refusal, and a `COMPLETED` record with TTL.
- Rate limiting is distributed (Valkey, IAM token), atomic (Lua), cluster-safe (hash tags),
  counts by real client IP behind two proxies, and fails open by an explicit decision.
- No `any` in non-test code. `pnpm audit --prod`: no known vulnerabilities.

**Important problems**

### S-1 — The API refuses every cross-origin browser request

- Type: Confirmed problem · Severity: **HIGH**
- File: `src/main.ts`, lines 27-40; SSM `/adh-shop/*`
- Evidence: `CORS_ALLOWED_ORIGINS` does not exist in Parameter Store, so `origin: false`.
  A preflight from another origin gets no CORS headers:

  ```
  OPTIONS /api/v1/transactions  Origin: https://example.cloudfront.net
  → HTTP/1.1 404 Not Found   (no Access-Control-Allow-Origin)
  ```

- Why it happens: the comment on lines 31-33 describes a deployment where one CloudFront
  distribution serves both the SPA and the API. That arrangement no longer exists: the API
  has its own domain behind Cloudflare, so the storefront will always be cross-origin.
- Impact: the storefront cannot call any endpoint from a browser. It blocks the frontend.
- Fix: publish `CORS_ALLOWED_ORIGINS` (the storefront's exact origin) from Terraform, keep
  `credentials` off unless cookies are introduced, and correct the comment. Add a preflight
  assertion to the container smoke test.

**Recommended improvements**

### S-2 — `/ready` always answers OK, and nothing uses it

- Type: Confirmed problem · Severity: MEDIUM
- File: `src/shared/infrastructure/health/health.controller.ts`, lines 26-33
- Evidence: returns a hardcoded `{ status: 'ok' }`; the comment says it will verify adapters
  "once adapters exist". They exist. `deploy.sh` and the image `HEALTHCHECK` probe `/health`.
- Scenario: a new container whose role cannot reach DynamoDB (a revoked permission, a
  wrong table name) passes the health check, receives traffic, and answers every request
  with 503 while the old, working container is retired.
- Fix: `/ready` performs a cheap bounded check (DynamoDB `DescribeTable` or `GetItem` with
  a short timeout); `deploy.sh` switches traffic on `/ready`, not `/health`.

**Minor improvements**

### S-3 — Gateway response bodies can reach the logs

- Type: Potential risk · Severity: LOW
- File: `checkout/infrastructure/payment/http-payment.gateway.ts`, `unexpected()`
- Evidence: an unexpected gateway response is wrapped as `PaymentGatewayUnavailable` with
  `response.body` as its cause; the filter logs the cause as JSON at error level.
- Scenario: the gateway changes a field type; every payment response is then logged whole,
  including `customer_email` and any customer data it echoes.
- Fix: log status, error type and field names only, as `rejection()` already does.

### S-4 — Stale comments describe infrastructure that no longer exists

- Type: Confirmed · Severity: LOW
- Files: `main.ts` lines 31-33 and 56-57, `client-ip.throttler-guard.ts` line 9,
  `environment.ts` (`TRUST_PROXY_HOPS`): "CloudFront" where the proxy is Cloudflare, and
  "same-origin" where it is not. `main.ts` lines 42-44 comment on probes above the
  trust-proxy block. S-1 exists partly because a comment was trusted.

### S-5 — Dead export

- Type: Confirmed · Severity: LOW · `dynamodb.provider.ts`: `DYNAMODB_TABLE` is never used.

### S-6 — Idempotency turns a successful charge into a 503 if recording the response fails

- Type: Potential risk · Severity: LOW
- File: `idempotency.interceptor.ts`, `mergeMap` + `catchError`
- Scenario: the charge succeeds, `complete()` fails on a DynamoDB throttle, `catchError`
  abandons the key and the client receives 503. A retry with the same key then gets
  `409 TRANSACTION_NOT_PAYABLE`. Nothing is charged twice, but the buyer sees two errors
  for a payment that went through.
- Fix: if `complete()` fails, log it and still return the handler's body.

**Action plan** — S-1 (P1), S-2 (P2), S-3, S-4, S-5, S-6 (P3).

---

# MODULE: Catalog (C)

**Responsibility** — lists and reads products with signed image URLs, and owns stock: the
atomic reserve, confirm and release transitions the checkout builds on.

**Grade** — 8.4 / 10

| Category            | Grade |
| ------------------- | ----: |
| NestJS architecture |  9/10 |
| Code                |  9/10 |
| TypeScript          |  8/10 |
| API                 |  7/10 |
| Security            |  9/10 |
| Auth                |   n/a |
| Database            |  9/10 |
| Performance         |  9/10 |
| Errors              |  7/10 |
| Testing             |  8/10 |
| Maintainability     |  9/10 |
| Scalability         |  9/10 |

**What is good**

- Stock transitions are single conditional `UpdateItem`s, so two buyers cannot take the
  last unit; `ReturnValuesOnConditionCheckFailure` tells "not found" from "sold out"
  without a second read.
- Listing is a `Query` on `GSI1`, never a `Scan`, paginated by an opaque cursor, capped at 50. The response DTO hides `reserved` and `version`.
- Image URLs are CloudFront-signed with a window-aligned expiry, so a URL is stable for an
  hour and cacheable. Verified in production: 200 signed, 403 unsigned or tampered.

**Recommended improvements**

### C-1 — A malformed pagination cursor is reported as a server outage

- Type: Confirmed problem · Severity: MEDIUM
- File: `dynamo-product.repository.ts`, `decodeCursor` and `findAll`
- Evidence (production):

  ```
  GET /api/v1/products?cursor=not-a-cursor → 503 CATALOG_UNAVAILABLE "Malformed pagination cursor"
  GET /api/v1/products?cursor=Ingi       → 503 CATALOG_UNAVAILABLE "Could not read the catalogue"
  ```

- Why it happens: an undecodable cursor is mapped to `CatalogUnavailable` (kind
  `UNAVAILABLE`); a decodable but wrong-shaped one reaches DynamoDB, which rejects the
  `ExclusiveStartKey`, and that is mapped to the same error.
- Impact: a client mistake is logged at error level, counts toward 5xx alerting, and tells
  well-behaved clients to retry something that can never succeed.
- Fix: an `InvalidCursor` error of kind `VALIDATION` (422), raised when the cursor does not
  decode to an object carrying exactly the `GSI1` key attributes of a `PRODUCT` item.

**Minor improvements**

### C-2 — An invalid unit count is reported as insufficient stock

- Type: Confirmed · Severity: LOW · `dynamo-product.repository.ts`, `transition()`: units
  `<= 0` return `InsufficientStock(units, 0)` (409) rather than `InvalidStock` (422).
  Unreachable today, because every caller validates units first.

### C-3 — Stored rows are rehydrated through validating factories

- Type: Potential risk · Severity: LOW · `toDomain` uses `Money.create` and `Stock.create`
  (and the checkout uses `DeliveryAddress.create`). Tightening a validation rule later
  makes existing rows unreadable, and their reads fail with 503. Rehydration should trust
  what was stored and validate only its shape.

**Action plan** — C-1 (P2), C-2 and C-3 (P3).

---

# MODULE: Checkout (K)

**Responsibility** — quotes, PENDING transactions that reserve stock, customers, card
payment through the gateway, settlement by webhook or polling, deliveries, and the expiry
of abandoned reservations.

**Grade** — 8.4 / 10

| Category            | Grade |
| ------------------- | ----: |
| NestJS architecture |  9/10 |
| Code                |  8/10 |
| TypeScript          |  8/10 |
| API                 |  9/10 |
| Security            |  8/10 |
| Auth                |   n/a |
| Database            |  9/10 |
| Performance         |  9/10 |
| Errors              |  9/10 |
| State/consistency   |  9/10 |
| External services   |  8/10 |
| Testing             |  7/10 |
| Maintainability     |  8/10 |
| Scalability         |  7/10 |

**What is good**

- Card data never reaches the service; only a gateway token is accepted, and anything shaped
  like card data is refused. Amount and email come from the stored transaction, and the
  charge carries an integrity signature.
- The total is computed server-side; a stale client total is refused with
  `422 AMOUNT_MISMATCH`.
- Two independent guards against double charge: the idempotency key, and a conditional
  claim written **before** the gateway is called. Verified in production.
- Settlement is one `TransactWriteItems` (transaction + stock + delivery). The webhook and
  the polling path race safely; a stock-row condition failure is not mistaken for a race.
- Webhook signatures are compared in constant time, and events older than 24 h are refused.
- A reservation with a payment in flight is never expired on the clock alone.
- Verified end to end in production against the sandbox: approval (stock sold, delivery
  created), decline (stock released), and expiry (unit returned, status `EXPIRED`).

**Recommended improvements**

### K-1 — A payment whose gateway id was not recorded cannot settle by polling

- Type: Potential risk · Severity: MEDIUM
- File: `application/find-transaction.usecase.ts`, `refresh()`; `pay-transaction.usecase.ts`
- Scenario:

  ```
  PayTransaction   claims the transaction           (paymentClaimedAt set)
  Gateway          accepts the charge, returns gw-1
  PayTransaction   update(gw-1) fails: DynamoDB throttled
                   → orElse re-reads, returns 202 with no gateway id stored
  Storefront       polls GET /transactions/:id
  FindTransaction  gatewayTransactionId undefined → returns PENDING, never asks the gateway
  ```

  The buyer watches PENDING until the sweeper finds the payment by reference: reservation
  deadline plus up to a minute, around 15 minutes. With no webhook registered, that is the
  only path.

- Fix: in `refresh()`, when the transaction is claimed but has no gateway id, use
  `findByReference`, as the sweeper already does.

### K-2 — Payments stuck PENDING at the gateway hold stock indefinitely and can starve the sweeper

- Type: Potential risk · Severity: MEDIUM
- File: `application/expire-reservations.usecase.ts`
- Evidence: a claimed transaction whose gateway status stays `PENDING` is deferred on every
  run, with no upper bound. `findExpiredReservations` reads the 25 **oldest** overdue rows,
  so those deferred rows always come first.
- Scenario: 25 payments abandoned mid-authentication and never finalised by the gateway.
  Every run reads the same 25, defers them all, and never reaches newer abandoned checkouts
  whose stock should return. Whether the gateway ever finalises such payments is not
  verifiable from the code.
- Fix: bound the wait. After a generous limit (for example 24 h past the deadline), move
  the transaction out of the pending index into a `REVIEW` state and log it at error level.
  Alternatively, page past deferred rows with `ExclusiveStartKey` within a run.

### K-3 — The critical DynamoDB expressions never execute in the test suite

- Type: Recommendation · Severity: MEDIUM
- Evidence: every repository spec asserts the command objects (`ConditionExpression`
  strings, `TransactItems` shape) against a stub client. The no-oversell condition, the
  claim race and the atomic settlement have only ever run against real DynamoDB in
  production smoke tests. `package.json` declares `test:e2e` with `./test/jest-e2e.json`,
  which does not exist (confirmed: the script cannot run).
- Impact: a typo in an expression passes every test and fails open in production. The
  previous finding on hash slots (limiter #12) was exactly that class of bug.
- Fix: integration specs against DynamoDB Local for `reserveUnits` under contention,
  `claimPayment` twice, and `saveSettlement` (approve, decline, conflict). Either create the
  e2e config or remove the script.

**Minor improvements**

### K-4 — A claim that loses to expiry reports the wrong reason

- Type: Confirmed · Severity: LOW · `dynamo-transaction.repository.ts`, `claimPayment`:
  every `ConditionalCheckFailedException` becomes `TransactionNotPayable('ALREADY_SUBMITTED')`,
  also when the sweeper expired the row first. The buyer is told a payment exists when the
  reservation actually expired. Fix: `ReturnValuesOnConditionCheckFailure` and report
  `FINAL` or `RESERVATION_EXPIRED` from the returned status.

### K-5 — An amount mismatch on settlement is logged as a warning

- Type: Recommendation · Severity: LOW · `payment-events.controller.ts`: a signed event
  approving an amount other than the one charged cannot happen without tampering or a
  gateway defect, and it leaves money taken with no delivery. It deserves error level and
  an alert, not the same warning as an unknown reference.

### K-6 — `GET /transactions/:id` has a side effect

- Type: Recommendation · Severity: LOW · Reading a PENDING transaction may settle it. The
  write is idempotent and converges on the gateway's truth, so a crawler or prefetch cannot
  cause harm, but it departs from `docs/guide/api-design.md` ("GET never changes state") and
  should be recorded there as a deliberate exception.

### K-7 — Anyone can overwrite a customer's name and phone by knowing their email

- Type: Potential risk · Severity: LOW · `dynamo-customer.repository.ts`: the upsert keyed
  by email takes name and phone from the latest checkout. Transactions keep their own
  snapshot, so orders and deliveries are unaffected; only the customer profile drifts.

### K-8 — Stored status values are cast, not checked

- Type: Recommendation · Severity: LOW · `toDomain` casts `item.status`; the delivery
  repository casts `item.status as DeliveryStatus`. An unknown value is treated as a final
  status. Rows are written only by this service, so the risk is a future migration.

### K-9 — Transaction and delivery reads are authorised by the id alone

- Type: Potential risk (design constraint) · Severity: LOW
- There are no accounts, so a UUID v4 is the credential. The id is unguessable, but it
  travels in URLs and browser storage. Mitigations in place: masked email and phone,
  `Cache-Control: no-store`, no listing endpoint. A stronger option, if needed: return a
  per-transaction access token at creation and require it on reads.

**Recommended architecture** — no structural change. The context split, the ports and the
atomic settlement are the right shape. The findings are behavioural gaps inside the current
structure.

**Action plan** — K-1 and K-2 (P2), K-3 (P2), K-4 to K-9 (P3).

---

# MODULE: Production and deployment (P)

**Responsibility** — the container image, the host, and how traffic reaches the process.

**Grade** — 6.5 / 10

**What is good** — multi-stage image, non-root user, `dumb-init` for signals, image
`HEALTHCHECK`, blue/green switch with health gate and rollback, secrets materialised from
SSM into a mode-600 file deleted after start, graceful shutdown hooks, HTTPS with HSTS.

### P-1 — The origin is reachable directly, bypassing the CDN and the rate limiter

- Type: Confirmed problem · Severity: **HIGH**
- Files: `adh-shop-infra/terraform/modules/ec2-container-host/main.tf` (ingress 80 and 443
  from `0.0.0.0/0`), `TRUST_PROXY_HOPS=2`
- Evidence (production, requests sent straight to the host IP with forged headers):

  ```
  X-Forwarded-For: 203.0.113.10 → X-RateLimit-Remaining: 99
  X-Forwarded-For: 203.0.113.11 → X-RateLimit-Remaining: 99
  X-Forwarded-For: 203.0.113.12 → X-RateLimit-Remaining: 99
  X-Forwarded-For: 203.0.113.10 → X-RateLimit-Remaining: 98
  ```

- Why it happens: two trusted hops assume Cloudflare is always the first. When a caller
  connects to nginx directly, nginx appends the caller's real address, and Express reads the
  attacker-supplied entry before it as the client.
- Impact: unlimited requests by rotating a header, and none of Cloudflare's DDoS or WAF
  protection applies. It defeats the control the rate-limit work exists for.
- Fix (infrastructure): allow 443 only from Cloudflare's published ranges, or use
  Authenticated Origin Pulls (mTLS). Serve the origin certificate from Cloudflare's origin CA
  so port 80 no longer needs to be public for ACME.

### P-2 — No memory limit on the container

- Type: Potential risk · Severity: LOW · `deploy.sh` runs `docker run` without `--memory`.
  A leak grows until the host swaps or the kernel kills another process, and during
  blue/green two containers share the host.

**Action plan** — P-1 (P1), P-2 (P3).

---

## Global summary

| Module                     | Grade | Critical |  High | Medium |    Low |
| -------------------------- | ----: | -------: | ----: | -----: | -----: |
| Shared kernel and platform |   8.2 |        0 |     1 |      1 |      4 |
| Catalog                    |   8.4 |        0 |     0 |      1 |      2 |
| Checkout                   |   8.4 |        0 |     0 |      3 |      6 |
| Production and deployment  |   6.5 |        0 |     1 |      0 |      1 |
| **Total**                  |       |    **0** | **2** |  **5** | **13** |

**Overall: 8.0 / 10.** The design and the domain are at a senior level: invariants are
enforced by the store, money never touches floats, the railway is consistent, and the payment
path is idempotent twice over. The grade is held down by two HIGH findings that are both
about the edge — who can reach the service, and from where — not about the business logic.

## Cross-cutting issues

- **Comments treated as facts.** S-1 and S-4 come from comments describing a topology that
  changed. When the infrastructure changes, the comments that justify the code need the same
  review as the code.
- **Tests assert commands, not effects.** Strong unit coverage (97%) and weak evidence that
  the DynamoDB expressions behave (K-3).
- **The edge is not part of the tests.** Neither CORS nor origin exposure is checked by
  anything automated (S-1, P-1).

## Technical debt

| Item | Class     | Origin                                | Risk if left                        | Cost   | Priority |
| ---- | --------- | ------------------------------------- | ----------------------------------- | ------ | -------- |
| P-1  | Important | Security group predates Cloudflare    | Rate limit and DDoS protection void | Small  | P1       |
| S-1  | Important | Topology changed after CORS was set   | Storefront cannot work              | Small  | P1       |
| K-3  | Moderate  | No DynamoDB Local in the suite        | Silent fail-open of an invariant    | Medium | P2       |
| K-1  | Moderate  | Polling assumes the gateway id exists | Buyer waits ~15 min for a result    | Small  | P2       |
| K-2  | Moderate  | Unbounded deferral                    | Stock held, sweeper starved         | Small  | P2       |
| C-1  | Moderate  | Cursor errors share the outage error  | False 5xx alerts                    | Small  | P2       |
| S-2  | Moderate  | Readiness left as a placeholder       | Broken release takes traffic        | Small  | P2       |
| Rest | Minor     | —                                     | —                                   | Small  | P3       |

## Global refactoring roadmap

**Phase 1 — Security and stability**: P-1 (restrict the origin to Cloudflare), S-1 (publish
the storefront origin and correct the comment).

**Phase 2 — P0/P1 bugs**: none at P0. C-1, K-1, K-2 and S-2 correct behaviour.

**Phase 3 — Architecture**: none required.

**Phase 4 — Performance and scalability**: K-2's pagination only, and only if deferred rows
are observed to accumulate.

**Phase 5 — Testing**: K-3, and a preflight check in the container smoke test.

**Phase 6 — Maintainability**: S-3 to S-6, C-2, C-3, K-4 to K-9, P-2.
