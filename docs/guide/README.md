# Engineering Guide

Standards for building and maintaining this API. These are the rules the codebase is
held to; the audits in `docs/audits/` measure the codebase against them.

| Guide                                | Covers                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| [architecture.md](./architecture.md) | Hexagonal layering, the dependency rule, Railway Oriented Programming |
| [api-design.md](./api-design.md)     | REST conventions, HTTP status codes, idempotency, pagination          |
| [security.md](./security.md)         | Secrets, sensitive data, OWASP API Top 10, dependency hygiene         |
| [testing.md](./testing.md)           | What to test, coverage policy, test doubles                           |
| [git-workflow.md](./git-workflow.md) | Branching, commit format, pull requests, releases                     |

## How to use this

Every rule here exists because breaking it caused a real problem, or because it
prevents one that is expensive to fix later. Where a rule is a judgement call rather
than a hard requirement, it says so.

A rule with no stated reason is a rule nobody will follow under pressure. If you find
one here without a rationale, that is a defect in the guide — fix it.

## Precedence

1. The project brief in the repository root.
2. These guides.
3. Personal preference.

When a guide conflicts with the brief, the brief wins and the guide should be updated
to record why.
