# pi-herdr-roles contributor instructions

This is an optional Pi role pack, not the pi-herdr-agents execution host and not a privileged default pack.

## Authorized Wave 1 scope

Extract the six existing roles `scout`, `planner`, `worker`, `reviewer`, `adversarial-reviewer` and `visual-tester` from pi-herdr-agents at the approved Maestro baseline. Move `/plan` and `skills/orchestrate/` with their required resources, tests and notices. Preserve methodology initially; update only paths, ownership wording and integration where needed. `poteto` belongs to pi-herdr-pstack. Do not add `/iterate` or `/btw`.

The canonical coordinated plans are in sibling pi-herdr-pstack's `docs/plans/`, especially `04-wave0-contract.md` and `03-release-waves.md`. The user authorized Waves 0–1, local repository initialization, isolated branches/worktrees and local commits only. Stop after Wave 1 for human review.

## Boundaries

- Use Pi packaging and `pi-herdr-subagents:roles:discover:v1`, registering synchronously and unsubscribing on shutdown.
- No private runtime imports, child runner, scheduler, model map or installer.
- pi-herdr-agents is a peer dependency and an explicit Pi installation prerequisite. Peers do not activate extensions.
- Keep this experimental package private; record tested host SHAs and do not present a temporary peer range as published compatibility.
- Preserve upstream notices and provenance. Keep non-role Markdown outside the registered roles directory.
- Retain optional prerequisites such as `chrome-cdp` visibly; do not install them or silently replace their functionality.
- Do not modify normal Pi settings, credentials, global roles or installed packages. Tests use isolated agent/config directories.
- No pushes, PRs, merges, publication or changes to external services. No delegated child orchestration.

## Verification

Keep package tests independent of the host's private module layout; exercise public discovery/tool/command contracts. Parent owns cross-package integration.

Coordinate all real Herdr lifecycle tests with the parent; only one suite runs at a time. Run unit/contract checks, formatting/lint where configured, `npm pack --dry-run`, `git diff --check`, and active LSP diagnostics for changed TypeScript when available. Report base/result SHAs, exact changes, checks, skipped coverage and integration risks. Do not claim unrun checks passed.
