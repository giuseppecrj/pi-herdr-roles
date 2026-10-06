# Provenance

All moved files come from [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents) at commit
`c2177dff835da44937e614e8a03d0405d442e848` (merged Maestro main; the package version string there was
still 2.0.5, which does not identify this revision on npm).

`test/fixtures/provenance.json` is the machine-readable record: SHA-256 of the
source blob and of the destination, plus every literal replacement and its
reason. `npm test` fails if a moved file changes without updating that record,
and reconstructs each destination from the source commit when a pi-herdr-agents
checkout is available.

| Destination | Source path at `c2177df` | Status |
| --- | --- | --- |
| `roles/scout.md` | `agents/scout.md` | unchanged |
| `roles/planner.md` | `agents/planner.md` | unchanged |
| `roles/worker.md` | `agents/worker.md` | unchanged |
| `roles/reviewer.md` | `agents/reviewer.md` | unchanged |
| `roles/adversarial-reviewer.md` | `agents/adversarial-reviewer.md` | adapted |
| `roles/visual-tester.md` | `agents/visual-tester.md` | adapted |
| `skills/plan/SKILL.md` | `pi-extension/subagents/plan-skill.md` | adapted |
| `skills/orchestrate/SKILL.md` | `skills/orchestrate/SKILL.md` | unchanged |
| `skills/orchestrate/adversarial-review.md` | `skills/orchestrate/adversarial-review.md` | unchanged |
| `skills/orchestrate/adversarial-review-example.js` | `skills/orchestrate/adversarial-review-example.js` | unchanged |
| `test/evals/cases.public.json` | `test/evals/cases.public.json` | unchanged |
| `test/evals/legacy-adversarial-reviewer.md` | `test/evals/legacy-adversarial-reviewer.md` | unchanged |
| `test/evals/oracle.json` | `test/evals/oracle.json` | unchanged |
| `test/evals/README.md` | `test/evals/README.md` | unchanged |
| `test/evals/score.mjs` | `test/evals/score.mjs` | adapted |
| `test/evals/score.test.mjs` | `test/evals/score.test.mjs` | unchanged |
| `test/evals/validate.mjs` | `test/evals/validate.mjs` | adapted |
| `test/evals/validate.test.mjs` | `test/evals/validate.test.mjs` | unchanged |
| `test/evals/type-guards.ts` | `maestro/core/config/type-guards.ts` | unchanged |
| `docs/review-evaluation.md` | `docs/review-evaluation.md` | adapted |
| `LICENSE` | `LICENSE` | unchanged |

## Adaptations

Methodology is unchanged. Edits are limited to ownership wording, paths that
would not resolve in this package, packaging text and private-import removal:

- `roles/adversarial-reviewer.md`: ownership: the host no longer bundles orchestrate.
- `roles/visual-tester.md`: ownership: name both packages that do not ship the optional prerequisite.
- `skills/plan/SKILL.md`: ownership: name the host package prerequisite.
- `skills/plan/SKILL.md`: ownership: the host no longer bundles roles.
- `skills/plan/SKILL.md`: path: the worktree guide remains host-owned and is not shipped in this pack.
- `test/evals/score.mjs`: no private host imports: vendored type guards.
- `test/evals/validate.mjs`: no private host imports: vendored type guards (Biome-formatted import).
- `docs/review-evaluation.md`: path: source role file now lives in another package.
- `docs/review-evaluation.md`: packaging: this pack uses a files allowlist.

`test/evals/type-guards.ts` is a verbatim copy of the host module the
evaluation scripts imported, so the pack does not import pi-herdr-agents
internals. `test/evals/legacy-adversarial-reviewer.md` remains a pinned
historical fixture and intentionally keeps its old wording.

## New files

`extensions/index.ts` (role-pack bridge and `/plan` command, adapted from the
host `/plan` handler and `examples/role-pack/extension.ts`), package metadata,
tests, `README.md`, `THIRD_PARTY_NOTICES.md` and this documentation are new in
this package.
