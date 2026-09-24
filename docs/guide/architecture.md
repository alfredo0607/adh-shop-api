# Architecture

Hexagonal architecture (ports and adapters) with Railway Oriented Programming for use
cases.

## Layout

```
src/
  contexts/
    <context>/
      domain/           Entities, value objects, domain errors, repository PORTS
      application/      Use cases. Orchestration only, no I/O, no framework
      infrastructure/   Adapters: DynamoDB, HTTP controllers, gateway clients
  shared/
    domain/             Result, ResultAsync — zero dependencies
    infrastructure/     Cross-cutting adapters (config, logging, clock)
```

A context is a business capability (`catalog`, `checkout`, `delivery`), not a technical
layer. If you cannot name a context without using the word "manager", "helper" or
"common", it is probably not a context.

## The dependency rule

**Dependencies point inwards. The domain depends on nothing.**

| Layer | May import |
| --- | --- |
| `domain` | Other files in its own `domain`, `shared/domain` |
| `application` | Its own `domain`, `shared/domain` |
| `infrastructure` | Everything |

This is enforced by ESLint, not by convention. `eslint.config.mjs` rejects imports of
`@nestjs/*`, `@aws-sdk/*`, `**/infrastructure/**` and `**/application/**` from any
domain file. Breaking the rule fails the build.

**Why.** The domain is the part that is expensive to get right and cheap to test. Once
it imports NestJS, testing it needs a DI container; once it imports the AWS SDK,
testing it needs AWS. Keeping it free of both is what makes a swap of ECS for Lambda —
which happened on this project — cost nothing in business logic.

## Ports and adapters

A port is an interface declared in `domain/`, named for what the domain needs, not for
what implements it.

```typescript
// domain/product.repository.ts — a PORT
export interface ProductRepository {
  findById(id: ProductId): ResultAsync<Product, ProductNotFound>;
  save(product: Product): ResultAsync<void, PersistenceFailure>;
}
```

```typescript
// infrastructure/dynamo-product.repository.ts — an ADAPTER
export class DynamoProductRepository implements ProductRepository { /* ... */ }
```

**Name ports after the need, never after the technology.** `PaymentGatewayPort`, not
`WompiClient`. The domain should not be able to tell which vendor is behind the port —
that is what makes the vendor replaceable, and on this project it is also a compliance
requirement, since the brief forbids the provider's name in the repository.

**Every external dependency gets a port**, including the ones that look too small to
deserve one: `ClockPort` and `IdGeneratorPort`. Without them, testing time-dependent or
ID-generating logic requires monkey-patching `Date` and `crypto`, which produces
flaky tests that fail at midnight.

## Use cases

A use case is one class with one public method. It orchestrates; it does not perform
I/O itself.

```typescript
export class ReserveStock {
  constructor(private readonly products: ProductRepository) {}

  execute(command: ReserveStockCommand): ResultAsync<Reservation, ReserveStockError> {
    return this.products
      .findById(command.productId)
      .andThen((product) => product.reserve(command.units))
      .andThen((reserved) => this.products.save(reserved).map(() => reserved.reservation));
  }
}
```

Rules:

- **No business logic in controllers.** A controller parses HTTP, calls one use case,
  maps the result to a status code. If a controller contains an `if` about business
  state, it is in the wrong place.
- **No framework decorators in `application/`.** Use cases are plain classes; wiring
  happens in the module file.
- **Invariants live on entities, not in use cases.** `product.reserve(units)` decides
  whether the reservation is legal. A use case that reads `product.stock` and compares
  it itself has stolen the entity's job, and the rule will be duplicated the second
  time someone needs it.

## Railway Oriented Programming

Use cases return `Result<T, E>` or `ResultAsync<T, E>`. They do not throw for business
outcomes.

**The distinction that matters:**

| Situation | Mechanism |
| --- | --- |
| Out of stock, card declined, product not found | `Err` — an expected outcome |
| Null dereference, malformed internal state, bug | `throw` — a defect |

A declined payment is not an exception; it is one of the two things that can happen
when you charge a card. Modelling it as a value means the compiler forces the caller to
handle it. Modelling it as an exception means the caller can forget.

**Contract for combinators.** Functions passed to `map`, `andThen` and `tap` must be
total — they must not throw and must not return a rejecting promise. All fallible I/O
enters the railway through `ResultAsync.fromPromise`, which takes an explicit handler
translating the failure into a domain error:

```typescript
ResultAsync.fromPromise(
  this.client.send(command),
  (cause) => new PersistenceFailure(cause),
);
```

Bypassing this — writing `.map(async (x) => this.client.send(x))` — compiles and looks
correct, but a rejection escapes the railway entirely and surfaces as HTTP 500. See
finding A-2 in `docs/audits/2026-09-24-backend-audit.md`.

**Error types are unions, not strings.** Each use case declares the errors it can
produce, so the HTTP layer can map them exhaustively:

```typescript
type ReserveStockError = ProductNotFound | InsufficientStock | PersistenceFailure;
```

## When not to apply this

This guide describes a deliberately structured architecture. It is justified here
because the domain has real invariants — stock cannot go negative, a transaction
cannot be paid twice — and because the brief asks for it.

Do not apply it reflexively. A service that only reads and writes rows with no
invariants does not need ports, use cases and a domain layer; it needs a controller and
a repository. Structure that does not earn its place is a cost, not a virtue.
