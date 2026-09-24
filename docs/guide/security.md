# Security

This repository is public and handles payment gateway credentials. The rules below are
ordered by how much damage breaking them causes.

## Secrets

**Nothing secret is ever committed.** Not in code, not in tests, not in a config file,
not "temporarily".

Git history is permanent. A key pushed and deleted in the next commit is still in the
repository, still in every clone, and still indexed by the bots that scan public
GitHub within minutes of a push. The only correct response to a committed secret is to
**rotate it**, then clean history — in that order, because rotation is what actually
stops the leak.

- `.gitignore` blocks `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.
- `.env.example` documents every variable with placeholder values only.
- Real values come from the environment, injected from Parameter Store or Secrets
  Manager in deployed environments.

Before any push that touches configuration:

```bash
git diff --cached | grep -nEi "prv_|pub_|secret|password|AKIA[0-9A-Z]{16}"
```

## Card data never reaches this API

The frontend tokenises the card directly against the payment gateway using the
**public** key. This service receives only `{ token, brand, lastFour }`.

**Why this is the architecture and not a detail:** the card number cannot leak from a
system that never holds it. No log scrubbing to get right, no database column to
encrypt, no backup to worry about, and PCI scope collapses to almost nothing.

The **private** key is used only server-side, to create the transaction. It is never
sent to the browser, never logged, and never appears in an error message.

If a code change would cause a PAN or CVV to enter this service, the change is wrong
regardless of how convenient it is.

## Logging

Never log: passwords, tokens, API keys, full card numbers, CVVs, authorisation headers,
full request bodies on payment endpoints.

Safe to log: transaction IDs, the last four digits, card brand, amounts, status
transitions, request IDs.

Use structured logging with a redaction list configured at the logger, not at each call
site — relying on every developer to remember is relying on nobody forgetting.

```typescript
redact: ['req.headers.authorization', 'req.body.token', '*.cvv', '*.card_number'],
```

Every log line carries the request ID from the response. A log you cannot correlate to
a user report is decoration.

## OWASP API Security Top 10 — the ones that apply here

**API1 Broken Object Level Authorization (IDOR).** `GET /transactions/:id` must verify
the caller owns that transaction. Authenticated is not authorised. This is the most
commonly exploited API flaw and the easiest to write by accident.

**API3 Excessive data exposure.** Never return a persistence entity directly. Map to an
explicit response DTO, so adding an internal field to an entity cannot silently publish
it.

**API4 Resource consumption.** Rate limiting on payment endpoints, pagination caps on
collections, body size limits.

**API5 Broken function level authorization.** Guards are declared per route. A route
with no guard is public — make that a deliberate decision, not an oversight.

**API8 Security misconfiguration.** `helmet` for security headers, CORS restricted to
known origins (serving the SPA and API from one CloudFront domain removes cross-origin
requests entirely), stack traces disabled in production.

**API10 Unsafe consumption of third-party APIs.** The payment gateway will time out,
rate-limit and return malformed responses. Every outbound call gets an explicit
timeout, bounded retries with backoff on idempotent operations only, and a validated
response shape. Never assume an external API is available or well-behaved.

## Webhooks

Inbound gateway webhooks are **untrusted input from the internet**. Anyone can POST to
that URL.

1. Verify the signature using the events secret before parsing the body.
2. Use a constant-time comparison — a fast `!==` leaks the signature byte by byte.
3. Treat delivery as at-least-once: the same event will arrive twice. Handlers must be
   idempotent.
4. Never trust amounts or status in the payload alone for a high-value transition.
   Confirm against the gateway API.

## Dependencies

Every dependency is code you ship and did not read.

- Add a dependency in the commit that first imports it, never in advance. Unused
  dependencies are pure supply-chain surface — see finding B-2.
- `pnpm audit --prod` runs in CI and fails the build on high severity.
- Install scripts are denied by default via `allowBuilds` in `pnpm-workspace.yaml`.
  Allowing one is a deliberate, reviewed decision.
- `pnpm-lock.yaml` is committed. Builds resolve from the lockfile, never fresh.

## Transport

HTTPS everywhere, terminated at CloudFront with a modern TLS policy. HSTS enabled.
No plaintext fallback.

## Error responses

An error tells the client what it needs and nothing more.

```
Wrong:  "DynamoDB ConditionalCheckFailedException on table adh-shop-prod, key PRODUCT#7"
Right:  "Insufficient stock"  (code: INSUFFICIENT_STOCK)
```

The first version tells an attacker the database engine, the table name and the key
schema. Log the detail; return the summary.
