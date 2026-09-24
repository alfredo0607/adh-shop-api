# Backend Technical Audit — 2026-09-24

| Field | Value |
| --- | --- |
| Audited commit | `649447b` (`main`) |
| Auditor role | Senior Backend Engineer / Tech Lead review |
| Method | `docs/prompts/prompt_auditoría.md` |
| Codebase size | 4 TypeScript files, 567 lines (232 production, 335 test) |
| Code changed during audit | None. Diagnosis only, per method §42. |

---

## 0. Scope and honest limitations

This is the point most audits get wrong, so it is stated first.

**The application does not exist yet.** At the audited commit the repository contains
exactly one code module — the shared kernel — plus project configuration. There are no
controllers, services, NestJS modules, DTOs, guards, pipes, interceptors, exception
filters, entities, repositories, authentication, database access or external
integrations.

Method rules §3 and §47.4 forbid inventing problems or functionality. The following
sections are therefore recorded as **not verifiable with the available code** rather
than filled with speculation:

| Method section | Status |
| --- | --- |
| §7 API design | Not verifiable — no endpoints exist |
| §8 DTOs and validation | Not verifiable — no DTOs exist |
| §9 Authentication | Not verifiable — not implemented |
| §10 Authorization / IDOR / BOLA | Not verifiable — not implemented |
| §12 Database / ORM | Not verifiable — no data access exists |
| §13 Transactions and consistency | Not verifiable — no multi-resource writes exist |
| §14 Concurrency and race conditions | Not verifiable — no shared mutable state exists |
| §17 Cache | Not applicable — none exists, and none is currently justified |
| §18 Queues and background jobs | Not applicable — none exist |
| §19 External services | Not verifiable — payment gateway adapter not written |
| §21 Logging | Not verifiable — no logger wired |
| §22 Observability | Not verifiable — no health checks or tracing |
| §29 E2E and API contracts | Not verifiable — no endpoints, no OpenAPI document |
| §31 Graceful shutdown | Not verifiable — no bootstrap file |

Auditing the two units that **do** exist is the entire honest scope. A grade assigned
to a module that has not been written would be meaningless.

---

## 1. Architecture as it exists today

```
src/
└── shared/
    └── domain/
        ├── result.ts          Result<T, E>      — synchronous railway
        ├── result-async.ts    ResultAsync<T, E> — asynchronous railway
        ├── result.spec.ts
        └── result-async.spec.ts
```

The intended architecture — hexagonal with ports and adapters, business logic outside
the controller layer, Railway Oriented Programming for use cases — is declared in the
commit history and **is already enforced mechanically**, which is unusual this early.

`eslint.config.mjs` applies `no-restricted-imports` to `src/contexts/*/domain/**` and
`src/shared/domain/**`, rejecting imports of `@nestjs/*`, `@aws-sdk/*`,
`**/infrastructure/**` and `**/application/**`. The hexagonal dependency rule is a
build failure, not a convention. This is a genuine strength and is graded as such.

No entry point exists, so there is currently no runtime architecture to describe: no
bootstrap, no dependency injection graph, no HTTP surface.

---

## 2. Module inventory

| # | Unit | Type | Files |
| --- | --- | --- | --- |
| 1 | Shared Kernel | Domain module | 4 |
| 2 | Project Configuration & Build | Configuration (method §4, §23, §30) | 12 |

Unit 2 is not a NestJS module. It is audited separately because method sections §4,
§23 and §30 explicitly require reviewing global configuration, environment handling
and production readiness — and it is where most findings live.

---

# MODULE 1: Shared Kernel

## Responsibility

Provides `Result<T, E>` and `ResultAsync<T, E>`, the types every use case in the
service will be written against. Models success and failure as values so that business
outcomes — a declined payment, an out-of-stock product — travel through the same
signature as success, and the compiler forces both branches to be handled.

## Grade

**8.4 / 10**

## Evaluation

| Category | Grade |
| --- | ---: |
| NestJS architecture | N/A — framework-free by design |
| Code quality | 9.0/10 |
| TypeScript | 8.5/10 |
| API design | N/A |
| Security | N/A — no I/O, no untrusted input |
| Authentication | N/A |
| Database | N/A |
| Performance | 9.0/10 |
| Error handling | 7.0/10 |
| Testing | 9.5/10 |
| Maintainability | 9.0/10 |
| Scalability | 8.5/10 |

Categories marked N/A are not scored rather than given an invented number. Averaging
the eight applicable categories gives 8.4.

The grade is held below 9 by one thing: this module's single purpose is to make error
handling explicit, and it has a hole through which errors escape implicitly (findings
A-1 and A-2). A module is judged hardest on its own reason for existing.

## What is genuinely good

- **Zero external dependencies.** `Result` is hand-written rather than pulled from
  `neverthrow`. In a hexagonal design the domain must not depend on third-party code;
  importing a library type into the core would undermine the boundary the whole
  architecture is built on. A correct and deliberate trade-off.
- **100% coverage that is not coverage theatre.** 70/70 statements, 12/12 branches,
  42/42 functions. More importantly the tests assert the *short-circuit property* —
  that steps following a failure never execute — using `jest.fn()` spies rather than
  only checking return values. A chain that kept charging a card after running out of
  stock would be a silent correctness bug, and these tests would catch it.
- **`combineAllErrors` alongside `combine`.** Distinguishing fail-fast (chained
  preconditions) from error-accumulating (form validation) is a real distinction most
  implementations miss.
- **`ResultAsync implements PromiseLike`.** Lets a chain be awaited and read
  imperatively where that is clearer, instead of forcing one style everywhere.
- **Type-level narrowing via `this is Ok<T, E>`** gives correct control-flow narrowing
  without assertions. There is not a single `any`, `as` or `!` in the module.

## Critical problems

None.

## High-priority problems

### A-1 — Exceptions thrown inside combinators escape the railway

**Type:** Confirmed problem · **Severity:** HIGH
**File:** `src/shared/domain/result.ts`
**Location:** `Ok.map` (~line 28), `Ok.andThen` (~line 41), `Ok.tap` (~line 47)

**Evidence.** There is not a single `try`/`catch` in the module:

```
$ grep -c "try\|catch" src/shared/domain/result.ts
0
```

```typescript
map<U>(fn: (value: T) => U): Result<U, E> {
  return new Ok<U, E>(fn(this.value));   // if fn throws, the exception propagates
}
```

**Demonstrated.** Executed against the audited commit:

```typescript
expect(() => ok<string, string>("{bad").map((raw) => JSON.parse(raw))).toThrow();
// passes — the exception escapes instead of becoming an Err
```

**Impact.** The module's contract is that business flow never throws. A caller writing
`result.match({ ok, err })` reasonably assumes both branches cover every outcome. When
a mapper throws, neither branch runs: the exception unwinds past the use case into the
framework's exception filter and surfaces as HTTP 500 instead of the intended domain
error.

**Why it happens.** The combinators apply `fn` directly with no boundary. This is a
defensible design — exceptions are reserved for bugs, and total functions should not
throw — but the contract is nowhere documented, so callers cannot know it.

**Scenario.** `.map((product) => JSON.parse(product.metadata))` on a malformed
DynamoDB attribute throws `SyntaxError`. Stock has already been reserved; the error
path that would release the reservation never executes.

**Recommended fix.** Do not add try/catch to `map` — that would make every mapper's
failure mode invisible. Instead:

1. Document the contract explicitly: functions passed to `map`/`andThen`/`tap` must be
   total and must not throw.
2. Add `Result.fromThrowable(fn, onThrow)` for boundaries where partial functions are
   unavoidable (parsing, decoding), making the conversion explicit at the call site.

### A-2 — Rejected promises inside `ResultAsync` combinators escape the railway

**Type:** Confirmed problem · **Severity:** HIGH — the more dangerous twin of A-1
**File:** `src/shared/domain/result-async.ts`
**Location:** `map` (~line 56), `andThen` (~line 74), `tap` (~line 84)

**Evidence.**

```typescript
map<U>(fn: (value: T) => U | Promise<U>): ResultAsync<U, E> {
  return new ResultAsync<U, E>(
    this.inner.then(async (result) =>
      result.isErr() ? err<E, U>(result.error) : ok<U, E>(await fn(result.value)),
    ),                                      // a rejection here rejects the chain
  );
}
```

**Demonstrated.** Executed against the audited commit:

```typescript
const chain = ResultAsync.ok<number, string>(1).map(async () => {
  throw new Error("DynamoDB ProvisionedThroughputExceeded");
});
await expect(chain).rejects.toThrow("ProvisionedThroughputExceeded");
// passes — a rejection, not an Err
```

**Impact.** This matters more than A-1 because asynchronous I/O *routinely* fails,
whereas pure mappers rarely throw. DynamoDB throttling, a gateway timeout and a network
reset are expected operating conditions, not bugs. Any adapter author who writes
`.map(async (t) => this.dynamo.put(t))` — the natural thing to write — silently opts
out of the error model the whole architecture depends on.

**Why it happens.** `ResultAsync.fromPromise` exists and does take an `onRejected`
handler, so the safe path is available. But nothing makes it the obvious path, and
`map`/`andThen` accept `Promise`-returning functions, which actively invites the unsafe
usage.

**Scenario.**

```
Use case: ReserveStock
  → .andThen(async (product) => this.repository.save(product))
  → DynamoDB returns ProvisionedThroughputExceededException
  → promise rejects
  → ResultAsync chain rejects instead of returning Err(StockUnavailable)
  → the HTTP layer's Result-to-status mapper never runs
  → client receives 500 instead of 409, and retry semantics are lost
```

**Recommended fix.** Decide the contract and enforce it before the first adapter is
written, because retrofitting means touching every use case:

- **Preferred:** have `map`/`andThen`/`tap` catch rejections and route them through a
  defect handler, so an unexpected rejection becomes a typed `Err` rather than
  escaping. This requires the error type to model "unexpected fault".
- **Alternative:** narrow the signatures so `map` accepts only synchronous functions,
  forcing all I/O through `fromPromise`, which already handles rejection correctly.

Either is defensible. Leaving it undecided is not.

## Recommended improvements

### A-3 — No error-recovery combinator

**Type:** Recommendation · **Severity:** MEDIUM
**File:** `src/shared/domain/result.ts`, `result-async.ts`

There is no `orElse` / `recover`. `mapErr` transforms an error but cannot return to the
success track. The checkout flow will need exactly that: retrying a gateway call after
a timeout, or falling back to a cached product. Without it, recovery must be written
imperatively with `await` and `if (r.isErr())` — the noise `ResultAsync` exists to
remove. Not a bug; a gap that will be felt as soon as the payment adapter lands.

## Minor improvements

### A-4 — `_tag` is dead code

**Type:** Confirmed problem · **Severity:** LOW
**File:** `result.ts` lines 15, 57

```
$ grep -rn "_tag" src/ | grep -v "readonly _tag"
(no results — never read)
```

Both classes declare `readonly _tag`, but discrimination happens through `isOk()` /
`isErr()` everywhere. Either remove it, or keep it deliberately for `switch`-based
narrowing and structured-log serialisation — but write that intent down.

### A-5 — `err<E, T = never>` inverts the type-parameter order

**Type:** Recommendation · **Severity:** LOW
**File:** `result.ts` (~line 120)

`Result<T, E>` puts the value first, but `err<E, T>` puts the error first, so call sites
read `err<string, number>("out of stock")` where `string` is the error type. Internally
consistent and forced by default-parameter ordering, but a papercut every caller hits.
Worth a doc comment at minimum.

### A-6 — No barrel export

`src/shared/domain/` has no `index.ts`, so consumers import from two separate paths.
Trivial, but worth fixing before dozens of call sites exist.

## Recommended architecture

The module's shape is correct and should not be restructured. The only structural
decision outstanding is the **defect boundary**: where an unexpected throw or rejection
becomes a typed value. Recommended end state:

```
shared/domain/
  result.ts          Result<T, E>          + fromThrowable
  result-async.ts    ResultAsync<T, E>     + rejection-safe combinators
  index.ts           barrel
```

with a documented contract stating (a) functions passed to combinators must be total,
and (b) all I/O enters the railway through `fromPromise` or a rejection-safe
combinator — never through a bare `async` mapper.

## Action plan

1. Decide and document the rejection contract (A-2). Blocks the first adapter.
2. Apply the same decision to the synchronous side, adding `fromThrowable` (A-1).
3. Add `orElse` when the first retry or fallback requirement appears — not before (A-3).
4. Resolve `_tag`: remove it or document its purpose (A-4).
5. Add `index.ts` and a note on `err` parameter order (A-5, A-6).

### Priorities

- **P0** — none.
- **P1** — A-2, A-1. Must be settled before the first adapter or use case is written.
- **P2** — A-3, A-4.
- **P3** — A-5, A-6.

---

# UNIT 2: Project Configuration & Build

## Responsibility

Toolchain, quality gates, dependency management and production readiness.
Method sections §4, §23, §24, §26, §30.

## Grade

**6.5 / 10**

## Evaluation

| Category | Grade |
| --- | ---: |
| Build configuration | 6.0/10 |
| TypeScript strictness | 9.5/10 |
| Linting / architecture enforcement | 9.5/10 |
| Dependency hygiene | 5.0/10 |
| Secret management | 8.0/10 |
| Production readiness | 3.0/10 |
| CI/CD | 2.0/10 |
| Documentation | 4.0/10 |

The strong static-analysis setup is dragged down by dependency and production-readiness
findings. Production readiness scores low because nothing exists yet — expected at this
stage, and recorded as project state rather than as a defect.

## What is genuinely good

- **Strict TypeScript beyond the defaults.** `noUncheckedIndexedAccess`,
  `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`. The first in particular catches a class of real bugs
  most projects ship with.
- **The hexagonal dependency rule is machine-enforced** (see §1). The single strongest
  signal in the repository.
- **`.gitattributes` normalising to LF** before any shell script exists, preventing a
  CRLF-in-Linux-container failure that is notoriously hard to diagnose.
- **`.gitignore` blocks `.env` and key material from the first commit.** The repository
  is public; a secret committed once stays in history forever.
- **pnpm pinned via `packageManager`, with an explicit `allowBuilds` allow-list**
  denying install scripts by default. `@scarf/scarf` telemetry is blocked deliberately.
  Meaningful supply-chain hygiene.

## High-priority problems

### B-1 — Four known vulnerabilities in a transitive dependency

**Type:** Confirmed problem · **Severity:** HIGH
**Evidence:** `pnpm audit --prod` at the audited commit:

```
high  multer vulnerable to Denial of Service via crafted request   multer  >=2.3.0
high  multer vulnerable to Denial of Service via file              multer  (unknown)
high  multer vulnerable to Denial of Service via oversized         multer  >=2.3.0
low   multer vulnerable to file size limit bypass                  multer  >=2.3.0
Path: . > @nestjs/core > @nestjs/platform-express > multer
Installed: multer@2.2.0
```

**Impact.** Three high-severity denial-of-service vectors reachable through the HTTP
layer once one exists.

**Mitigating factor, stated honestly.** `multer` only activates on multipart routes, and
the codebase has no upload endpoints — grep for `FileInterceptor`, `@UploadedFile` and
`multer` in `src/` returns nothing. Practical exposure today is zero. It is still ranked
HIGH because it ships in the production dependency tree, it will be inside the container
image, and a dependency audit in CI will fail on it.

**Recommended fix.** A pnpm override, which resolves three of the four without waiting
on NestJS:

```yaml
# pnpm-workspace.yaml
overrides:
  multer: '>=2.3.0'
```

The fourth advisory has no published patch and should be tracked, not blocked on.

## Recommended improvements

### B-2 — Ten production dependencies declared but never imported

**Type:** Confirmed problem · **Severity:** MEDIUM
**File:** `package.json`

`helmet`, `compression`, `nestjs-pino`, `zod`, `class-validator`, `class-transformer`,
`@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/throttler` and `@aws-sdk/client-dynamodb`
appear in `dependencies`; none is imported anywhere in `src/`.

**Impact.** Every one is transitive supply-chain surface and container image weight
carrying zero function — `@aws-sdk/client-dynamodb` alone is substantial. B-1 is a direct
illustration: a vulnerability arrived through a dependency the project does not yet use.

**Why it happens.** They were installed up front in anticipation of planned features.

**Recommended fix.** Add each dependency in the commit that first imports it. This keeps
`package.json` an accurate statement of what the service needs, and keeps each addition
reviewable in the PR that justifies it.

### B-3 — `pnpm build` exits 0 while producing an unrunnable artifact

**Type:** Confirmed problem · **Severity:** MEDIUM
**Evidence:**

```
$ pnpm build && echo "exit=$?"
exit=0
$ find dist -name "*.js"
dist/result-async.js
dist/result.js          # no dist/main.js

$ node dist/main.js
Error: Cannot find module '.../dist/main.js'
```

`package.json` declares `"start:prod": "node dist/main.js"` but `src/main.ts` does not
exist, and with no entry point `tsc` flattens output to the `dist/` root.

**Impact.** The missing entry point is expected — the application has not been written.
The finding is not "main.ts is missing"; it is that **a green build is currently
meaningless as a quality signal**. A CI pipeline gating on `pnpm build` would pass while
producing an image that crash-loops on start.

**Recommended fix.** When CI is added, gate on something that proves the artifact runs —
a container start with a health-check probe — not only on compilation.

### B-4 — No `.env.example` despite configuration being environment-driven

**Type:** Confirmed problem · **Severity:** MEDIUM

`.gitignore` explicitly whitelists `!.env.example`, so the pattern was intended, but the
file was never created. There is no documented list of the variables the service needs.
With payment gateway credentials, table names and region all arriving through the
environment, this is the difference between a service someone else can run and one only
its author can.

**Recommended fix.** Create `.env.example` with every variable, placeholder values only,
alongside the config module that reads them.

### B-5 — No CI pipeline, so branch protection has no teeth

**Type:** Confirmed problem · **Severity:** MEDIUM
**Evidence:** `.github/workflows/` does not exist. Branch protection on `main` reports
`required_status_checks: null`.

**Impact.** Pull requests are mandatory and history is linear, which is good, but nothing
verifies that tests pass, coverage holds at 80% or the code lints before a merge. The 80%
Jest threshold is currently enforced only when someone runs it locally.

**Recommended fix.** A workflow running lint, typecheck, tests with coverage and a
dependency audit, registered as required status checks on `main`.

## Minor improvements

### B-6 — `.dockerignore` exists with no `Dockerfile`

Harmless, but it signals a file written ahead of its purpose. Verify it matches the build
context when the `Dockerfile` is actually added.

### B-7 — Coverage exclusions predate the files they exclude

`jest.config.ts` excludes `**/*.module.ts` and `**/*.port.ts`; neither exists yet. Both
exclusions are legitimate — DI wiring and compile-time-only interfaces — but given that
30 of the test's 100 points ride on coverage above 80%, an evaluator may scrutinise what
was excluded. Keep the list minimal and be ready to justify it.

## Action plan

1. Apply the `multer` override and re-run `pnpm audit --prod` (B-1).
2. Add the CI workflow and register required status checks (B-5).
3. Remove unused dependencies; reintroduce each with the commit that imports it (B-2).
4. Create `.env.example` with the config module (B-4).
5. Gate CI on a running container, not only on a green compile (B-3).

### Priorities

- **P0** — none.
- **P1** — B-1, B-5.
- **P2** — B-2, B-4, B-3.
- **P3** — B-6, B-7.

---

## Global summary

Units are listed in repository order, not ranked.

| Unit | Grade | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shared Kernel | 8.4/10 | 0 | 2 | 1 | 3 |
| Project Configuration & Build | 6.5/10 | 0 | 1 | 4 | 2 |
| **Total** | — | **0** | **3** | **5** | **5** |

**How solid is this backend?** The question cannot be answered yet, and saying otherwise
would be dishonest: there is no backend, only its foundation. What can be judged is
whether the foundation is worth building on, and it is. The architectural boundary is
enforced by tooling rather than by discipline, the type system is configured strictly,
and the one module that exists is tested to 100% with tests that assert behaviour rather
than chase the number.

The three HIGH findings share a common shape: **decisions deferred rather than decided.**
What happens when a promise rejects inside the railway (A-2), what happens when a mapper
throws (A-1), and which dependencies the service actually needs (B-2). None is expensive
now. All become expensive once use cases and adapters exist, because the fix stops being
local.

---

## Cross-cutting issues

**1. The defect boundary is undefined (A-1, A-2).** The single most important unresolved
question in the codebase. Every future use case and adapter inherits the answer, and
retrofitting it means touching all of them.

**2. Dependencies precede their use (B-2, with B-1 as its consequence).** Ten unused
production dependencies already produced four vulnerabilities. The pattern, not the
individual packages, is the finding.

**3. Quality gates exist but are unenforced (B-5).** A strict tsconfig, an
architecture-enforcing ESLint rule and an 80% coverage threshold are all configured, and
none of them runs automatically. The gates are real; the enforcement is not.

**4. Documentation is entirely commit-message-borne.** Design rationale lives in commit
bodies and PR descriptions. Better than nothing and better than most, but not
discoverable by someone reading the repository. `docs/guide/` addresses this and is
delivered alongside this audit.

---

## Technical debt

### Important debt — resolve before feature work continues

**Undefined defect boundary** (A-1, A-2)
*Origin:* combinators written without deciding the exception contract.
*Impact:* the error model can be silently bypassed by ordinary-looking code.
*Risk:* grows with every use case written against the current behaviour.
*Cost now:* roughly half a day including tests. *Cost after ten use cases:* days, plus
regression risk across every one of them.
*Priority:* P1 — before the first adapter.

### Moderate debt — schedule it

**Unused dependency surface** (B-2, B-1)
*Origin:* installing the full anticipated stack in the scaffolding commit.
*Impact:* supply-chain exposure and image size with no functional return.
*Cost:* ~1 hour. *Priority:* P2.

**Unenforced quality gates** (B-5)
*Origin:* CI deferred until after the application layer.
*Impact:* nothing prevents a regression from reaching `main`.
*Cost:* ~2 hours. *Priority:* P1 — it compounds with every subsequent merge.

### Minor debt

Dead `_tag` field (A-4), missing barrel export (A-6), `err` parameter order (A-5), orphan
`.dockerignore` (B-6). Roughly an hour in total; no urgency.

---

## Global refactoring roadmap

Per method §42, no code was changed during this audit. This is the proposed plan.

### Phase 1 — Security and stability

- Apply the `multer` override; re-run `pnpm audit --prod` (B-1).
- Decide and document the defect boundary, then implement it (A-2, A-1).

### Phase 2 — P0/P1 bugs

No P0 items. A-1 and A-2 are the P1 items and are carried by Phase 1.

### Phase 3 — Architecture

- Add `fromThrowable` and, if the chosen contract requires it, rejection-safe combinators.
- Add the barrel export and resolve `_tag` (A-6, A-4).

### Phase 4 — Performance and scalability

Nothing to do. No performance problem is demonstrable in a module with no I/O, and the
method (§47.15) forbids recommending premature optimisation.

### Phase 5 — Testing

- Add CI running lint, typecheck, coverage and audit; register as required checks (B-5).
- Extend kernel tests to cover the newly defined defect boundary.

### Phase 6 — Maintainability

- Remove unused dependencies (B-2).
- Create `.env.example` (B-4).
- Gate CI on a running container (B-3).

---

## Next audit

Repeat once the first vertical slice — catalogue context, its HTTP adapter and its
DynamoDB adapter — exists. At that point the sections recorded above as "not verifiable"
become auditable, and the security, concurrency and API-design analysis this project is
actually evaluated on can be carried out against real code.
