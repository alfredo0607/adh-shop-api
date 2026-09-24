# Testing

Coverage above 80% is a hard requirement on this project, enforced as a Jest threshold.
But coverage is a floor, not a goal — it measures which lines ran, not whether they are
correct.

## What to test, in priority order

1. **Domain invariants.** Stock cannot go negative. A transaction cannot be paid twice.
   These are the rules the business would lose money over.
2. **Use case orchestration**, especially failure paths: what happens when the gateway
   times out after stock was reserved.
3. **Adapters** against a real DynamoDB Local — mapping bugs are invisible to unit
   tests with mocks.
4. **HTTP contract**: status codes, validation rejection, error shapes.

## Test the behaviour, not the implementation

```typescript
// Weak — passes even if reserve() does nothing useful
expect(repository.save).toHaveBeenCalled();

// Strong — fails if the invariant breaks
const result = product.reserve(5);
expect(result.isErr()).toBe(true);
expect(product.availableUnits).toBe(2); // unchanged after a rejected reservation
```

A test that asserts which methods were called breaks on every refactor and catches no
bugs. A test that asserts observable outcomes survives refactoring and catches real
regressions.

## Assert the failure path explicitly

The kernel tests show the pattern worth copying: they prove that steps after a failure
**never execute**.

```typescript
const charge = jest.fn(() => ResultAsync.ok('charged'));

const result = await ResultAsync.ok(1)
  .andThen(() => ResultAsync.err('out of stock'))
  .andThen(charge);

expect(charge).not.toHaveBeenCalled(); // this is the real assertion
```

Without the spy, a chain that kept charging after running out of stock would still
return the right error and the test would pass. The bug would ship.

## Test doubles

**Prefer in-memory implementations of ports over mocks.**

```typescript
class InMemoryProductRepository implements ProductRepository {
  private readonly items = new Map<string, Product>();
  findById(id: ProductId) {
    /* ... */
  }
  save(product: Product) {
    /* ... */
  }
}
```

One in-memory adapter serves every use case test, runs in milliseconds, needs no
Docker, and — unlike a mock — actually behaves like a repository, so a use case that
saves twice or reads stale data fails the test.

Mocks are for asserting that something was _not_ called, or for simulating failures an
in-memory double cannot produce (a network timeout).

**Inject `ClockPort` and `IdGeneratorPort`** rather than stubbing globals. Tests that
patch `Date.now` are the ones that fail at midnight and on the last day of the month.

## Coverage policy

- Global threshold: 80% statements, branches, functions, lines. CI fails below it.
- Excluded: `main.ts` (bootstrap, covered end-to-end), `*.module.ts` (DI wiring,
  no logic), `*.port.ts` (interfaces, erased at compile time).
- **Keep the exclusion list minimal and justifiable.** Excluding a file because it is
  hard to test is gaming the metric. If you exclude something, be able to defend it.

Branch coverage matters most. Statement coverage of 100% with 60% branch coverage means
every error path is untested — which is the half that matters.

## What not to test

- Framework behaviour. NestJS routing works; testing it tests NestJS.
- Getters, DTOs, constants.
- Third-party libraries.

Tests are code: they are read, maintained and refactored. A test that cannot fail is
pure cost.

## Structure

```typescript
describe('ReserveStock', () => {
  describe('when the product has enough units', () => {
    it('reserves them and persists the product', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

Name tests as sentences describing behaviour. `it('rejects a reservation larger than
available stock')` tells you what broke from the CI output alone;
`it('test reserve 2')` requires opening the file.

## Running

```bash
pnpm test           # watch-free run
pnpm test:cov       # with coverage and threshold enforcement
pnpm test:watch     # during development
```
