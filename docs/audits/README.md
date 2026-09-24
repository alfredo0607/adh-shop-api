# Audits

Technical audits of this codebase, newest first. Each is a point-in-time diagnosis
against the method in `docs/prompts/prompt_auditoría.md`.

| Date | Audit | Scope | Critical | High | Medium | Low |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 2026-09-24 | [Backend audit](./2026-09-24-backend-audit.md) | `649447b` — shared kernel + configuration | 0 | 3 | 5 | 5 |

## Conventions

- One file per audit, named `YYYY-MM-DD-<scope>.md`.
- Audits are **diagnosis only**. No code is changed while auditing — the fixes land in
  their own pull requests, referencing the finding ID.
- Findings are identified as `A-1`, `B-2` and so on, scoped per unit, so commits and
  PRs can cite them.
- Anything that cannot be verified from the code is recorded as
  "not verifiable with the available code" rather than assumed.

## Separation from `docs/guide/`

`docs/guide/` holds the standards the codebase is held to. `docs/audits/` records how
the codebase measured against them on a given date. Guides are living documents;
audits are immutable once written — supersede them with a newer audit rather than
editing them.

## Next audit

Due once the first vertical slice exists (catalogue context with its HTTP and DynamoDB
adapters). At that point the API design, security, concurrency and data-access sections
become auditable for the first time.
