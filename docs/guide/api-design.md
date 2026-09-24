# API Design

Correct use of HTTP is explicitly assessed on this project. These rules are the ones
worth being strict about.

## Resources and verbs

```
GET    /api/v1/products                    list
GET    /api/v1/products/:id                read
POST   /api/v1/transactions                create
GET    /api/v1/transactions/:id            read
POST   /api/v1/transactions/:id/payment    execute an action on a resource
PATCH  /api/v1/deliveries/:id              partial update
```

- Plural nouns for collections. No verbs in paths — `/transactions/:id/payment`, never
  `/payTransaction`.
- `GET` never changes state. This is not style: crawlers, proxies and browser prefetch
  will issue your `GET` requests without asking.
- `PATCH` for partial updates, `PUT` only for full replacement. If you do not support
  full replacement, do not expose `PUT`.
- Version in the path (`/api/v1`) from the first endpoint. Adding versioning later
  means breaking every client at once.

## Status codes

The two mistakes that matter most:

**1. A business failure is not an HTTP error.** A declined card means the request was
understood, processed and answered correctly — the _payment_ failed, not the _request_.

```
POST /transactions/:id/payment
  → 202 Accepted, body: { status: "DECLINED", reason: "INSUFFICIENT_FUNDS" }
```

Returning `500` for a declined payment tells the client's retry logic to try again,
which is exactly wrong. Reserve `5xx` for faults that are genuinely the server's.

**2. `200` for everything.** A creation returns `201` with a `Location` header. An
accepted-but-not-finished operation returns `202`. A successful delete with no body
returns `204`.

| Code | Use for                                                         |
| ---- | --------------------------------------------------------------- |
| 200  | Successful read or update returning a body                      |
| 201  | Resource created — include `Location`                           |
| 202  | Accepted, outcome not yet final (async gateway call)            |
| 204  | Success with no body                                            |
| 400  | Malformed request — unparseable body, wrong types               |
| 401  | Not authenticated                                               |
| 403  | Authenticated but not permitted                                 |
| 404  | Resource does not exist, or must not be revealed to this caller |
| 409  | Conflict with current state — out of stock, already paid        |
| 412  | `If-Match` precondition failed (optimistic concurrency)         |
| 422  | Well-formed but semantically invalid — expiry date in the past  |
| 429  | Rate limited — include `Retry-After`                            |
| 500  | Unhandled server fault. Never deliberate.                       |

`400` vs `422`: could the request be parsed? If not, `400`. If it parsed but the values
are not acceptable, `422`.

## Idempotency

**Any endpoint that moves money must be idempotent.** A client that times out and
retries must not be charged twice, and clients _will_ retry.

```
POST /api/v1/transactions/:id/payment
Idempotency-Key: 9f2c1e4a-...
```

Store the key with the result. On replay, return the original response with `200`
rather than executing again. Keys expire after 24 hours.

This is not optional on this codebase: a mobile client on an unreliable connection is
the expected case, not the edge case.

## Never trust the client with amounts

The client may send what it _expects_ to pay. The server recalculates the total from
its own prices and fees, and rejects the request with `422` if they disagree.

If the server accepts a client-supplied amount, the product costs whatever the buyer
edits it to in the browser console.

## Response shape

Consistent envelopes. Errors always the same shape:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 2 units available",
    "details": [{ "field": "units", "requested": 5, "available": 2 }]
  },
  "requestId": "01JC..."
}
```

- `code` is a stable machine-readable enum; clients branch on it. `message` is for
  humans and may change without notice.
- Include `requestId` in every response, success and failure, and log it. It is the
  only thing that makes a production report actionable.
- **Never leak internals.** No stack traces, no SQL, no driver messages, no internal
  IDs. Map unknown failures to a generic message and log the detail server-side.

## Pagination

Every collection endpoint is paginated from day one, even when you know there are only
eight products. Unbounded list endpoints are how services die in production.

DynamoDB pages by cursor, so expose a cursor rather than an offset:

```
GET /api/v1/products?limit=20&cursor=eyJwayI6...
→ { "items": [...], "nextCursor": "eyJwayI6..." }
```

Cap `limit` server-side. A client asking for 10,000 gets the cap, not an error.

## Validation

Validate at the HTTP boundary with `ValidationPipe` configured as:

```typescript
new ValidationPipe({
  whitelist: true, // strip unknown properties
  forbidNonWhitelisted: true, // reject them loudly
  transform: true,
});
```

`whitelist` is what prevents mass assignment — a client adding `"role": "admin"` or
`"amount": 1` to a payload has those fields stripped before they reach any logic.

Boundary validation checks _shape_. Business rules — "this transaction can be paid" —
belong on the entity, not in a DTO decorator.

## Documentation

Every endpoint carries OpenAPI decorators describing request, response and every status
code it can return. The brief requires a published Swagger URL or Postman collection.

Documentation that does not match behaviour is worse than none, because it is trusted.
Generate it from the code, never maintain it by hand.
