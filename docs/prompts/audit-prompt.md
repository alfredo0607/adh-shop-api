# COMPLETE TECHNICAL AUDIT — NODE.JS / NESTJS BACKEND

I want you to act as a Senior Software Architect + Senior Backend Engineer + Senior
Node.js/NestJS Developer + Security Reviewer + Code Reviewer, with experience in
enterprise backend systems, REST APIs, scalable architectures and production
applications.

Your standard must be that of a Tech Lead reviewing the backend of an application that
will have to be maintained for several years and support real growth in users, traffic
and functionality.

I do NOT want a superficial audit.

I do NOT want you to simply run through a checklist.

I want you to understand the architecture, the data flow and the responsibilities of
each module before drawing conclusions.

---

## 1. PRIMARY OBJECTIVE

You must carry out a deep technical audit of the backend, module by module.

The application is built primarily with:

- Node.js
- NestJS
- TypeScript
- REST API
- Controllers
- Services
- Modules
- Dependency Injection
- DTOs
- Pipes
- Guards
- Interceptors
- Exception Filters
- Middleware
- JWT / authentication
- Authorization / roles / permissions
- ORM or direct database access
- SQL / NoSQL, where applicable
- Redis / cache, where applicable
- Queues / workers, where applicable
- WebSockets, where applicable
- Docker, where applicable
- PM2, where applicable
- Environment variables
- Testing
- Logging
- Observability

Adapt the audit to the technologies that actually exist in the project.

Do not assume a technology is present simply because it is common in NestJS.

---

## 2. MAIN RULE: ANALYSE MODULE BY MODULE

You must first identify the application's real modules.

For example:

- Auth
- Users
- Roles
- Permissions
- Dashboard
- Vehicles
- Notifications
- Reports
- Billing
- etc.

These are only examples.

You must use the real modules found in the code.

For each module:

1. Understand its responsibility.
2. Identify every related file.
3. Understand the complete flow.
4. Review Controller → Service → Repository/Database.
5. Review DTOs.
6. Review Guards.
7. Review Pipes.
8. Review Interceptors.
9. Review Exception Filters.
10. Review related Middleware.
11. Review validations.
12. Review authentication/authorization.
13. Review data access.
14. Review error handling.
15. Review performance.
16. Review security.
17. Review testing.
18. Review architecture.
19. Review maintainability.
20. Review scalability.

Do NOT draw conclusions about a module after reviewing only one or two files.

---

## 3. FUNDAMENTAL RULE: DO NOT INVENT

Do not invent problems.

Do not invent functionality.

Do not assume behaviour that cannot be demonstrated from the code.

If something cannot be verified, you must state:

Not verifiable with the available code.

Clearly distinguish between:

**Confirmed problem**

There is direct evidence in the code.

**Potential risk**

A situation exists that could cause a problem depending on conditions that cannot be
fully verified.

**Recommendation**

Not necessarily a bug, but a technically justifiable improvement.

**Optional improvement**

A quality improvement that is not required for correct operation.

Do NOT flag as a problem something that is merely a personal architectural preference.

---

## 4. UNDERSTAND THE ARCHITECTURE FIRST

Before auditing the modules, identify:

- Overall architecture.
- Folder organisation.
- NestJS modules.
- Dependencies between modules.
- Application entry point.
- Global configuration.
- Database.
- ORM in use.
- Authentication system.
- Authorization system.
- External services.
- Cache.
- Queues.
- WebSockets.
- Logging system.
- Testing.
- Docker.
- Production configuration.

Briefly explain how the architecture currently works.

Do NOT propose changing the architecture yet.

Understand the existing architecture first.

---

## 5. NESTJS ARCHITECTURE REVIEW

Analyse specifically:

### Modules

Review:

- Responsibility of each module.
- Cohesion.
- Coupling.
- Unnecessary imports.
- Unnecessary exports.
- Circular dependencies.
- Oversized modules.
- Modules holding too many responsibilities.
- Dependencies between modules.
- Correct reuse of modules.
- Shared modules.
- Global modules.

Ask:

Does the module separation genuinely represent the responsibilities of the domain?

### Controllers

Review:

- Oversized controllers.
- Business logic inside the controller.
- Direct database access.
- Unnecessary manual validation.
- Transformations that belong in services.
- Duplicated code.
- Incorrect handling of HTTP status codes.
- Inconsistent responses.
- Poorly defined parameters.
- Overly complex endpoints.

A controller should mainly handle:

HTTP → validation/transformation → delegation → response.

Detect any significant deviation.

### Services

Review:

- Oversized services.
- God services.
- Mixed responsibilities.
- Direct HTTP access where inappropriate.
- Duplicated business logic.
- Excessive dependencies.
- Overly long methods.
- Transactions.
- Error handling.
- Reuse.

Determine whether the service correctly represents the business logic.

### Dependency Injection

Review:

- Correct dependency injection.
- Unnecessary dependencies.
- Circular dependencies.
- Incorrect use of forwardRef.
- Manual instantiation of classes that should use DI.
- Unnecessary providers.
- Unnecessary global providers.
- Dependency Inversion violations.

Do NOT recommend abstracting everything merely to apply SOLID.

---

## 6. ARCHITECTURE AND SEPARATION OF RESPONSIBILITIES

Determine whether there is a reasonable separation between:

```
Controller
    ↓
Service / Use Case
    ↓
Repository / Data Access
    ↓
Database
```

Where the architecture in use differs, explain why it may be valid.

Look for:

- Business logic inside controllers.
- SQL inside controllers.
- SQL inside DTOs.
- Database access from guards without need.
- Services mixing infrastructure and domain.
- External integrations mixed with business logic.
- Duplicated business rules.

---

## 7. API DESIGN

Review every endpoint in the module.

Analyse:

- REST conventions.
- HTTP methods.
- HTTP status codes.
- Resource naming.
- Path parameters.
- Query parameters.
- Request body.
- Response structure.
- Pagination.
- Filtering.
- Sorting.
- Search.
- Versioning.
- Idempotency.
- Consistency across endpoints.
- Error responses.

Detect:

- 200 used incorrectly.
- POST where PUT/PATCH belongs.
- GET modifying data.
- Endpoints with multiple responsibilities.
- Inconsistent responses.
- Internal data accidentally exposed.

---

## 8. DTOs AND VALIDATION

Review:

- DTOs.
- class-validator.
- class-transformer.
- ValidationPipe.
- whitelist.
- forbidNonWhitelisted.
- Transformations.
- Required validations.
- Duplicated validations.
- Overly generic DTOs.
- DTOs reused incorrectly.
- Response DTOs.
- Accidental exposure of entities.

Analyse whether validation happens in the right place.

Verify in particular:

```
HTTP input
    ↓
Validation
    ↓
Transformation
    ↓
Business logic
```

Untrusted data must never reach sensitive logic without validation.

---

## 9. AUTHENTICATION

Audit in depth:

- JWT.
- Access tokens.
- Refresh tokens.
- Expiry.
- Rotation.
- Revocation.
- Storage.
- Secrets.
- Password hashing.
- Login.
- Logout.
- Sessions.
- Token reuse.
- Token leakage.
- Brute force.
- Rate limiting.

Review:

- bcrypt / argon2, where applicable.
- Hardcoded secrets.
- Weak JWT secrets.
- Tokens stored incorrectly.
- Tokens written to logs.
- Excessively long expiry.
- Unprotected refresh tokens.

---

## 10. AUTHORIZATION

Verifying that the user is authenticated is not enough.

Review:

- Roles.
- Permissions.
- Guards.
- Policies.
- Resource ownership.
- RBAC.
- ABAC, where applicable.

Look specifically for:

### IDOR / BOLA

For example:

```
GET /users/123
```

It must be verified that the authenticated user actually has permission to access
resource 123.

Look for cases where:

authenticated ≠ authorized

---

## 11. SECURITY

Carry out a security audit based on real risks.

Review:

- OWASP API Security.
- Injection.
- SQL Injection.
- NoSQL Injection.
- XSS where applicable.
- CSRF where applicable.
- SSRF.
- IDOR / BOLA.
- Broken authentication.
- Broken authorization.
- Mass assignment.
- Excessive data exposure.
- Rate limiting.
- Brute force.
- Sensitive data exposure.
- Security headers.
- CORS.
- Helmet.
- Input validation.
- File uploads.
- Path traversal.
- Command injection.
- Deserialization.
- Dependency vulnerabilities.

Also review:

- .env.
- Secrets.
- API keys.
- Database credentials.
- Private keys.
- Tokens.
- Logs.
- Error messages.

Never assume something is secure merely because it uses NestJS.

---

## 12. DATABASE / ORM

Identify the technology in use:

- PostgreSQL
- MySQL
- MongoDB
- DynamoDB
- Prisma
- TypeORM
- Sequelize
- Mongoose
- mysql2
- etc.

Audit:

- Queries.
- Indexes.
- Relations.
- N+1 queries.
- Joins.
- Transactions.
- Connection pooling.
- Connection leaks.
- Pagination.
- Sorting.
- Filtering.
- Query complexity.
- Lazy loading.
- Eager loading.
- Locking.
- Concurrency.
- Constraints.
- Foreign keys.
- Unique constraints.
- Nullability.
- Data consistency.

Look especially for:

**N+1 queries** — demonstrate the concrete scenario where they occur.

**Unnecessary queries.**

**Queries inside loops.**

**Missing indexes** — only flag a missing index where there is sufficient evidence to
justify it.

---

## 13. TRANSACTIONS AND CONSISTENCY

Review operations that modify multiple resources.

Determine whether they need transactions.

Example:

```
Create Order
    ↓
Create Payment
    ↓
Update Inventory
```

If an operation fails at step 3, what happens to the preceding steps?

Look for:

- Partially completed operations.
- Missing rollbacks.
- Incorrect transactions.
- Oversized transactions.
- Potential deadlocks.
- Race conditions.
- Concurrency issues.

Do not flag an operation as problematic merely because it does not use a transaction.

Explain first why one would be necessary.

---

## 14. CONCURRENCY AND RACE CONDITIONS

Pay particular attention to:

- Simultaneous requests.
- Concurrent updates.
- Double submit.
- Inventory.
- Counters.
- States.
- Payments.
- Reservations.
- Locks.
- Transactions.
- Concurrent jobs.
- Duplicate processing.
- Retries.

Do not assume a race condition exists merely because the code is async.

You must demonstrate:

1. The scenario.
2. Request A.
3. Request B.
4. The shared state.
5. The incorrect result.

---

## 15. ASYNC / PROMISES

Review:

- async/await.
- Promises.
- Promise.all.
- Promise.allSettled.
- Error handling.
- Unnecessary sequential requests.
- Parallelisable requests.
- Fire-and-forget.
- Unhandled promises.
- Missing awaits.
- Blocking operations.

Look for:

```
await A()
await B()
await C()
```

where it would actually be safe to run:

```
await Promise.all([A(), B(), C()])
```

But do NOT optimise automatically.

First determine whether a dependency exists between the operations.

---

## 16. BACKEND PERFORMANCE

Audit:

- Response time.
- Database queries.
- N+1.
- Serialisation.
- Payloads.
- Cache.
- Redis.
- CPU-intensive operations.
- Memory usage.
- Event loop blocking.
- External requests.
- Concurrency.
- Connection pools.
- Pagination.
- Compression.
- Streaming.

Look especially for operations that can block the event loop:

- heavy file processing;
- very large loops;
- expensive cryptography;
- synchronous processing;
- enormous JSON payloads;
- CPU-bound operations.

---

## 17. CACHE

If Redis or another cache exists, review:

- What is cached.
- TTL.
- Invalidation.
- Cache keys.
- Stale data.
- Cache stampede.
- Cache poisoning.
- Consistency.
- Memory usage.

Ask:

Does the caching strategy genuinely improve the system, or does it only add complexity?

Do not recommend caching without a demonstrable need.

---

## 18. QUEUES AND BACKGROUND JOBS

If they exist:

- BullMQ.
- Bull.
- SQS.
- RabbitMQ.
- Kafka.
- Workers.
- Cron jobs.

Review:

- Retries.
- Backoff.
- Dead letter queue.
- Idempotency.
- Duplicate processing.
- Job locking.
- Concurrency.
- Timeouts.
- Error handling.
- Observability.
- Poison messages.

A job must be able to fail without leaving the system in an inconsistent state.

---

## 19. EXTERNAL SERVICES

Review integrations with:

- External APIs.
- AWS.
- Firebase.
- Stripe.
- Payment gateways.
- Email providers.
- SMS.
- Maps.
- Storage.
- etc.

Analyse:

- Timeout.
- Retry.
- Backoff.
- Circuit breaker where necessary.
- Error handling.
- Rate limits.
- Credentials.
- Idempotency.
- Logging.
- Fallbacks.

Never assume an external API will always be available.

---

## 20. ERROR HANDLING

Review:

- Exception filters.
- HttpException.
- Custom exceptions.
- Status codes.
- Error responses.
- Internal errors.
- Database errors.
- External API errors.
- Validation errors.
- Authentication errors.
- Authorization errors.

Look for unnecessary try/catch blocks.

But also look for missing handling where it is genuinely needed.

Determine whether the system can:

- hide sensitive information;
- return stack traces;
- filter errors correctly;
- maintain a consistent error structure.

---

## 21. LOGGING

Review:

- console.log.
- The NestJS logger.
- Winston.
- Pino.
- Structured logging.
- Log levels.
- Correlation IDs.
- Request IDs.
- Sensitive data.

The following must never appear in logs:

- passwords;
- JWTs;
- refresh tokens;
- API keys;
- secrets;
- sensitive information.

Assess whether the logs would allow a production incident to be investigated.

---

## 22. OBSERVABILITY

Review where applicable:

- Logs.
- Metrics.
- Tracing.
- Health checks.
- Readiness.
- Liveness.
- Monitoring.
- Error tracking.
- Request IDs.

Ask yourself:

If this endpoint starts failing in production at 3 AM, could the team quickly discover
why?

---

## 23. CONFIGURATION

Audit:

- .env.
- ConfigModule.
- Environment variables.
- Configuration validation.
- Development/production environments.
- Defaults.
- Secrets.
- Hardcoded configuration.

Look for:

```
if (process.env.NODE_ENV === ...)
```

repeated throughout the application.

Assess whether a centralised configuration strategy exists.

---

## 24. TYPESCRIPT

Review:

- any.
- unknown.
- never.
- Type assertions.
- as.
- Non-null assertions (!).
- Interfaces.
- Types.
- Generics.
- DTOs.
- Entities.
- Response types.
- Union types.
- Discriminated unions.

Look for types that hide errors.

Example:

```typescript
const data = response.data as User;
```

Determine whether there is any actual guarantee that `data` is a `User`.

Also grade the quality of the typing.

---

## 25. ENTITIES, DTOs AND MODELS

Determine whether there is adequate separation between:

- Database entity
- DTO
- Domain model
- API response

Do not assume all four layers must always exist.

Assess whether the current architecture is sufficient for the project.

Look for direct exposure of entities:

```typescript
return user;
```

where this could expose:

- password hashes;
- internal IDs;
- secrets;
- internal fields;
- sensitive metadata.

---

## 26. CLEAN CODE AND MAINTAINABILITY

Look for:

- God services.
- God controllers.
- God modules.
- Overly long functions.
- Duplicated code.
- Dead code.
- Unnecessary imports.
- Magic numbers.
- Magic strings.
- Hardcoding.
- Unclear names.
- Unnecessary abstractions.
- Obsolete comments.
- Important TODOs.
- Excessive cyclomatic complexity.

Do not recommend abstracting code merely because it appears twice.

Determine whether the abstraction genuinely improves maintenance.

---

## 27. SOLID AND PATTERNS

Evaluate where genuinely applicable:

- Single Responsibility.
- Open/Closed.
- Liskov Substitution.
- Interface Segregation.
- Dependency Inversion.
- DRY.
- Separation of Concerns.
- Composition.
- Repository pattern.
- Service layer.
- Strategy.
- Factory.
- Adapter.
- CQRS.

IMPORTANT:

I do NOT want you to force patterns.

A simple, clear architecture is preferable to an excessively complex one.

If there is no real need for CQRS, the repository pattern, a factory and so on, do not
recommend them merely because they are "best practice".

---

## 28. TESTING

Review:

- Unit tests.
- Integration tests.
- E2E.
- Controller tests.
- Service tests.
- Repository tests.
- API tests.
- Authentication tests.
- Authorization tests.
- Error cases.
- Edge cases.
- Race conditions.
- Transactions.

If there are no tests, do NOT simply say "tests are missing".

Determine:

1. Which parts should have tests.
2. What risk exists.
3. Which tests are the highest priority.
4. Which critical behaviour is unprotected.

Prioritise tests covering:

- authentication;
- authorization;
- business logic;
- transactions;
- calculations;
- states;
- critical integrations.

---

## 29. E2E AND API CONTRACTS

Review whether critical endpoints have E2E coverage.

Analyse:

- Request.
- Authentication.
- Validation.
- Business logic.
- Database.
- Response.
- Error handling.

If Swagger/OpenAPI exists, review:

- Documentation.
- DTOs.
- Responses.
- Status codes.
- Authentication.
- Examples.

Determine whether the documentation genuinely represents the backend's behaviour.

---

## 30. PRODUCTION

Determine whether the backend is ready for production.

Review:

- Debug logs.
- Secrets.
- Environment configuration.
- CORS.
- Helmet.
- Rate limiting.
- Compression.
- Graceful shutdown.
- Health checks.
- Database connection handling.
- Process management.
- Docker.
- PM2.
- Memory limits.
- Error reporting.
- Monitoring.
- Security headers.
- API versioning.

---

## 31. GRACEFUL SHUTDOWN

Review whether the application correctly handles:

- SIGTERM.
- SIGINT.
- Database connections.
- HTTP connections.
- Workers.
- Queues.
- WebSockets.

Especially where it uses:

- Docker.
- Kubernetes.
- ECS.
- EC2.
- PM2.
- Auto Scaling.

---

## 32. SCALABILITY

Ask for each module:

"If this module had ten times the users, requests and data, would it still work
correctly?"

Analyse:

- Database.
- Connections.
- Cache.
- API.
- Memory.
- CPU.
- Queues.
- External services.
- Pagination.
- Concurrency.

Distinguish between:

**Current problem** — there is already evidence that the design causes a problem.

**Scalability risk** — it currently works, but there is a demonstrable limitation as it
grows.

Do not invent hypothetical problems without justifying the scenario.

---

## 33. RED FLAGS

Identify specifically:

- God modules
- God services
- God controllers
- Circular dependencies
- SQL injection
- Broken authorization
- Sensitive data exposure
- N+1 queries
- Race conditions
- Memory leaks
- Event loop blocking
- Missing transactions
- Poor error handling
- Excessive abstraction
- Premature optimisation
- Code duplication
- Hardcoded values
- Excessive use of any

---

## 34. SEVERITY

Classify every problem:

**CRITICAL** — can cause:

- a serious vulnerability;
- data loss;
- data corruption;
- exposure of sensitive information;
- significant system outage;
- serious production errors.

**HIGH** — an important problem that should be fixed soon.

**MEDIUM** — affects maintainability, performance, quality or scalability.

**LOW** — a minor improvement.

**OPTIONAL** — a quality improvement that is not necessary.

---

## 35. MANDATORY EVIDENCE

Every confirmed problem must include:

- Problem
- File
- Line/section
- Evidence
- Impact
- Why it happens
- The scenario in which it manifests
- Recommended fix
- Code example, where necessary

Do NOT make claims such as:

"This may cause performance problems."

You must explain: which operation causes the problem → why → under what scenario →
what impact it produces.

---

## 36. RACE CONDITIONS

When you detect a possible race condition you must demonstrate it.

Use this format:

```
Request A
    ↓
Reads state X
Request B
    ↓
Reads state X
Request A
    ↓
Updates X
Request B
    ↓
Updates X
```

Then explain the incorrect result.

Do not flag any asynchronous code as a race condition.

---

## 37. KEEP / IMPROVE / REFACTOR / REMOVE / ADD

For each module produce:

**Keep** — what is well implemented.

**Improve** — what can be improved without major refactoring.

**Refactor** — what needs a structural change.

**Remove** — what code, abstractions or complexity should be removed.

**Add** — what technical functionality is missing.

---

## 38. GRADING

Each module must receive a grade:

X / 10

Use:

- 9 – 10: Excellent.
- 8 – 8.9: Very good.
- 7 – 7.9: Good.
- 6 – 6.9: Acceptable.
- 5 – 5.9: Fair.
- 4 – 4.9: Poor.
- 1 – 3.9: Critical.

Do NOT be generous.

The grade must be supported by evidence.

---

## 39. EVALUATION MATRIX

For each module:

| Category              | Grade |
| --------------------- | ----: |
| NestJS architecture   |  X/10 |
| Code quality          |  X/10 |
| TypeScript            |  X/10 |
| API design            |  X/10 |
| Security              |  X/10 |
| Authentication        |  X/10 |
| Authorization         |  X/10 |
| Database              |  X/10 |
| Performance           |  X/10 |
| Error handling        |  X/10 |
| State/consistency     |  X/10 |
| External services     |  X/10 |
| Configuration         |  X/10 |
| Logging/observability |  X/10 |
| Testing               |  X/10 |
| Maintainability       |  X/10 |
| Scalability           |  X/10 |

Then calculate an overall grade for the module and explain how you arrived at it.

---

## 40. PER-MODULE AUDIT FORMAT

Use exactly this structure:

### MODULE: [Name]

**Responsibility** — explain what the module actually does according to the code.

**Grade** — X / 10

**Evaluation**

| Category            | Grade |
| ------------------- | ----: |
| NestJS architecture |  X/10 |
| Code                |  X/10 |
| TypeScript          |  X/10 |
| API                 |  X/10 |
| Security            |  X/10 |
| Auth                |  X/10 |
| Database            |  X/10 |
| Performance         |  X/10 |
| Errors              |  X/10 |
| Testing             |  X/10 |
| Maintainability     |  X/10 |
| Scalability         |  X/10 |

**What is good** — list only genuine strengths found.

**Critical problems** — confirmed problems.

**Important problems** — high-priority problems.

**Recommended improvements** — medium priority.

**Minor improvements** — low priority.

**Technical findings** — for each finding:

- Problem
- Type: Confirmed problem / Potential risk / Recommendation
- Severity
- File
- Location
- Evidence
- Impact
- Why it happens
- Scenario
- Recommended fix
- Code example

**Recommended architecture** — explain how the module should look after a possible
refactor. Do NOT write the full refactoring code yet. Explain the proposed architecture
first.

**Action plan** — order the tasks.

---

## 41. PRIORITIES

At the end of each module:

**P0 — Critical.** Must be fixed immediately.

**P1 — High.** Must be fixed before adding further significant functionality.

**P2 — Medium.** Must be planned.

**P3 — Low.** Optional improvement.

---

## 42. DO NOT REFACTOR DURING THE AUDIT

IMPORTANT:

Do NOT change code.

Do NOT write commits.

Do NOT generate patches.

Do NOT refactor automatically.

Complete the diagnosis first.

I want to know:

1. What is wrong.
2. Why it is wrong.
3. What impact it has.
4. How urgent it is.
5. How it should be fixed.

Once the whole audit is finished you may produce the refactoring plan.

---

## 43. GLOBAL SUMMARY

After reviewing ALL modules:

| Module | Grade | Critical | High | Medium |
| ------ | ----: | -------: | ---: | -----: |
| Auth   |  X/10 |        X |    X |      X |
| Users  |  X/10 |        X |    X |      X |
| …      |     … |        … |    … |      … |

Do NOT order modules from best to worst.

Respect the application's original order.

---

## 44. CROSS-CUTTING ISSUES

Identify problems affecting several modules:

- Architecture
- Security
- Authentication
- Authorization
- Database
- API
- Performance
- Error handling
- Configuration
- Logging
- Observability
- Testing
- Typing
- Dependencies

---

## 45. TECHNICAL DEBT

Classify:

**Critical debt** — must be resolved.

**Important debt** — should be resolved before adding further functionality.

**Moderate debt** — can be planned.

**Minor debt** — future improvements.

For each item explain:

- origin;
- impact;
- risk;
- approximate cost to resolve;
- priority.

---

## 46. GLOBAL REFACTORING ROADMAP

Finally produce:

**Phase 1 — Security and stability.** Security problems, crashes, data loss/corruption
and critical issues.

**Phase 2 — P0/P1 bugs.** Correct incorrect behaviour.

**Phase 3 — Architecture.** Resolve structural problems.

**Phase 4 — Performance and scalability.** Optimise only demonstrated problems or
clearly justifiable risks.

**Phase 5 — Testing.** Add coverage for critical behaviour.

**Phase 6 — Maintainability.** Cleanup, technical debt reduction and structural
improvements.

---

## 47. FINAL RULES

1. Do not perform a superficial review.
2. Analyse module by module.
3. Read every related file before drawing conclusions.
4. Do not invent problems.
5. Do not invent functionality.
6. Do not assume an architectural decision is incorrect.
7. Distinguish real bugs from recommendations.
8. Prioritise real problems over personal preference.
9. Do not perform unnecessary refactoring.
10. Do not force design patterns.
11. Do not recommend microservices merely because the application may grow.
12. Do not recommend CQRS without a real need.
13. Do not recommend the repository pattern by default.
14. Do not recommend caching without justifying the problem it solves.
15. Do not recommend premature optimisation.
16. Treat security as a priority.
17. Consider concurrency and data consistency.
18. Consider behaviour in production.
19. Always provide evidence from the code.
20. If you find a good implementation, say so.
21. Do not change code during the audit.
22. Finish the diagnosis first.
23. Then produce the refactoring roadmap.
24. If something cannot be verified, say so explicitly.
25. Do not confuse "not ideal" with "incorrect".

---

## 48. FINAL CRITERION

I want you to think as a Senior Backend Engineer + Tech Lead + Software Architect
reviewing a pull request for an enterprise system that will have to be maintained for
years.

Not as a linter.

Not as a teacher hunting for academic mistakes.

Not as someone trying to find as many problems as possible.

The objective is to find the real technical problems that have impact, demonstrate why
they exist, determine their severity and explain what should be done about them.

A simple, correct implementation must be given credit even if it uses no sophisticated
patterns.

A complex implementation must be challenged if that complexity is not justified.

---

## 49. DELIVERABLES

On completing the audit you must produce:

1. **Complete audit** — the detailed module-by-module review.
2. **Global summary** — with grades and problem counts.
3. **Cross-cutting issues** — problems affecting several modules.
4. **Technical debt** — classified by priority.
5. **Refactoring roadmap** — organised by phases.
6. **Documentation** — the audit must be organised so that it can become technical
   documentation for the project.

If a documentation structure such as the following exists:

```
docs/
├── guide/
└── audits/
```

use it as follows:

**`docs/guide/`** — for technical documentation and backend guides.

**`docs/audits/`** — for audits, per-module reviews, findings and improvement plans.

Do NOT mix general project documentation with specific audit results.

---

## FINAL OBJECTIVE

The result must make it possible to answer clearly:

- How solid is this backend really?
- What real problems does it have?
- Which are critical?
- What should be fixed first?
- Which parts are well built and should be kept?
- What technical debt exists?
- What would have to change to bring the backend to a senior/production level?
