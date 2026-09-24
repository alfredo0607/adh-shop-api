# Git Workflow

Trunk-based development: `main` plus short-lived feature branches.

## Branches are not environments

`main` is the only long-lived branch. There is no `develop`, no `staging` branch, no
`production` branch.

**Why.** If each environment builds from its own branch, each environment builds a
different artifact — so what was tested in staging is not what shipped to production.
The correct model separates the two concerns:

> **Promote the artifact, not the code.**

Build the container image once, tag it with the commit SHA, and promote that exact
digest through environments. Environments differ by injected configuration, never by
code. What reaches production is bit-for-bit what passed the tests.

A long-lived `develop` branch also produces merge debt with no benefit when the team is
small and deploys are continuous. GitFlow earns its complexity when you maintain
several released versions at once — not here.

## Branch naming

```
feat/catalog-context
fix/stock-reservation-race
chore/upgrade-nest-11
docs/technical-audit
ci/github-actions
```

Short-lived: hours or days, not weeks. A branch open for two weeks is a merge conflict
being written slowly.

## Commits

Conventional Commits, in English:

```
<type>(<scope>): <subject in the imperative>

<body: why, not what>
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `perf`.

**The body explains why.** The diff already shows what changed; it cannot show what you
considered and rejected. Six months later that reasoning is the only thing that makes
the code safe to change.

```
feat(shared): add Result and ResultAsync for railway oriented programming

Both types live in the domain layer and have zero external dependencies,
which is the whole argument of the hexagonal boundary. That rules out
pulling in a library such as neverthrow.
```

One logical change per commit. If the subject needs "and", it is two commits.

## Pull requests

Every change to `main` goes through a PR. Direct pushes are blocked by branch
protection.

A PR description states:

1. **Context** — why this change exists.
2. **What changes** — the shape of the change, not a file list.
3. **Design decisions** — alternatives considered and why they were rejected.
4. **Testing** — what is covered, and what deliberately is not.

Keep PRs small enough to review properly. A 2,000-line PR receives approval, not
review.

## Branch protection on `main`

| Rule                    | Setting                                       |
| ----------------------- | --------------------------------------------- |
| Pull request required   | Yes                                           |
| Approvals required      | 0 — a solo author cannot approve their own PR |
| Linear history          | Required                                      |
| Force push              | Blocked                                       |
| Branch deletion         | Blocked                                       |
| Conversation resolution | Required                                      |
| Status checks           | Required once CI exists                       |

Approvals are set to zero deliberately so a single maintainer is not locked out. On a
team, raise it to 1 and require a code owner.

## Rewriting history

**Never force-push `main`.** Branch protection enforces it.

On a feature branch, rewriting before review is fine and often the right thing —
squashing fixups, correcting a commit message. After review has started, rewriting
discards the reviewer's context.

**Learned on this project:** force-pushing a branch with an open PR permanently closes
that PR — GitHub refuses to reopen a PR whose commits no longer exist. If history must
be rewritten with a PR open, close the PR first, rewrite, then open a new one.

## Releases

Tag `main` with SemVer (`v1.2.0`). The container image carries the commit SHA as its
primary tag, since that is what uniquely identifies the artifact. Version tags are for
humans; SHAs are for machines.
