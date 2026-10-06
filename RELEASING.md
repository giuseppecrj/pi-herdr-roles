# Release guide

GitHub Actions publishes this package when the version in `package.json` changes on `main`. The release workflow (`.github/workflows/publish.yml`, adapted from pi-herdr-agents) reads the package name and version from `package.json`, validates the package, publishes to npm, creates a matching `vX.Y.Z` tag, and creates a GitHub Release with generated notes and a link to the npm package.

The published version must be unique on npm.

## Current state: experimental, not released

`pi-herdr-roles` is `0.1.0-experimental.0` with `"private": true`. npm holds only a placeholder prerelease under the `pi-herdr-roles` name; no package content has been published from this repository.

While the package is private or its version is not a strict `major.minor.patch`, the workflow's detect step reports a notice and sets `release=false`. Dependency or metadata changes to `package.json` therefore pass CI without releasing. Once the package is public with a stable version, the host workflow's rules apply: a stable version must increase, an unchanged version does not release, and a decrease fails. The first stable version may keep the core of the previous prerelease (for example `0.1.0-experimental.0` to `0.1.0`), and removing `"private"` at an unchanged stable version releases that version.

Do not design a release that creates a GitHub Release without a successful npm publish for a new version. The workflow publishes first, then tags and creates the GitHub Release.

## Prerequisites

You need:

- Permission to manage this repository's GitHub Actions settings and npm package access for `pi-herdr-roles`
- A clean local `main` branch

Automated release gates (run by the workflow and required locally):

```bash
npm ci
npm run format:check
npm run lint
npm run check        # typecheck, lint, format:check, unit/contract tests
npm pack --dry-run
```

In GitHub Actions the optional checks controlled by `PI_HERDR_AGENTS_HOST`, `PI_HERDR_AGENTS_LEGACY_HOST` and `PI_HERDR_AGENTS_SOURCE` skip because those variables are unset and no sibling pi-herdr-agents checkout exists. Run them locally before a release (see [Development](README.md#development)).

## First real release

1. Remove `"private": true` from `package.json`.
2. Set a stable version (for example `0.1.0`) with `npm version 0.1.0 --no-git-tag-version`, which also regenerates `CHANGELOG.md`.
3. Replace the temporary `"*"` peer ranges for `pi-herdr-agents` and `@earendil-works/pi-coding-agent` with real ranges covering the published role-free host you tested, and update [compatibility](docs/compatibility.md) with the tested host SHA and version.
4. Run the role-free host checks against that host:

   ```bash
   PI_HERDR_AGENTS_HOST=/path/to/role-free/pi-herdr-agents npm run check
   ```

5. Run the real-Herdr coverage this package documents: real child launches, child-scope resource visibility and worktree lifecycle are not covered by this repository's tests (see [compatibility](docs/compatibility.md)). They belong to the parent-owned sequential Herdr integration suite. Run it from inside Herdr with this pack installed beside the role-free host, one suite at a time. Do not release from skipped Herdr tests.
6. Confirm the `npm pack --dry-run` contents (below), then commit and push the release commit as described in [Publish a release](#publish-a-release).

Confirm the package preview includes `README.md`, `CHANGELOG.md`, `RELEASING.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `docs/compatibility.md`, `docs/provenance.md`, `docs/review-evaluation.md`, `extensions/index.ts`, exactly the six role files in `roles/` (`scout`, `planner`, `worker`, `reviewer`, `adversarial-reviewer`, `visual-tester`), `skills/plan/SKILL.md`, and `skills/orchestrate/` (`SKILL.md`, `adversarial-review.md`, `adversarial-review-example.js`). Confirm it contains no non-role Markdown under `roles/`, no `poteto` resources, no tests, evals or fixtures, and no `.github/`, plans, sessions, evidence, `.pi/` or local configuration.

## npm authentication

### Steady state: trusted publishing (tokenless)

npm trusted publishing (OIDC) is already configured for `pi-herdr-roles`: GitHub Actions, owner `giuseppecrj`, repository `pi-herdr-roles`, workflow filename `publish.yml`. Because the package name already exists on npm (as a placeholder), no bootstrap token is needed. No long-lived `NPM_TOKEN` is required.

The release job has `permissions.id-token: write`, runs on a GitHub-hosted runner, and uses the exactly pinned Node `26.3.0`, whose bundled npm supports trusted publishing. Publish stays tokenless: `npm publish --access public --provenance`.

When the repository secret `NPM_TOKEN` is absent, the publish step unsets `NODE_AUTH_TOKEN` and relies on OIDC. Once the package exists, the workflow fails if `NPM_TOKEN` is still configured, so steady-state releases cannot silently keep using a bootstrap credential. Manual dispatch runs only from `main`; other refs are rejected.

### Bootstrap path

The workflow keeps the host's bootstrap path: a temporary `NPM_TOKEN` may publish a package that does not yet exist on npm. It is not needed here because the package exists. Later version bumps use trusted publishing only. Do not add `NPM_TOKEN`: the workflow rejects it once the package exists.

## Publish a release

Choose the semantic version increment:

- `patch`: compatible bug fixes, such as `0.1.0` to `0.1.1`
- `minor`: compatible features, such as `0.1.0` to `0.2.0`
- `major`: breaking changes, such as `0.1.0` to `1.0.0`

Create the version commit without a local tag:

```bash
git fetch --tags --prune
npm version patch --no-git-tag-version
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v$(node -p \"require('./package.json').version\")"
git push origin main
```

The `npm version` hook regenerates `CHANGELOG.md` with `auto-changelog`. Use `npm run changelog` to regenerate it without changing the version.

Replace `patch` with `minor` or `major` when appropriate. The push triggers the **Release** workflow, which installs dependencies, runs formatting, lint, typecheck and unit/contract tests, previews package contents, publishes to npm with provenance, creates and pushes the version tag, and creates the GitHub Release.

You can rerun a failed or incomplete release from **Actions → Release → Run workflow**. If npm already has `PACKAGE_NAME@VERSION`, the workflow reads that version's `gitHead` and continues only when it matches `GITHUB_SHA` (exact-commit retry). A foreign publish fails before tag or GitHub Release creation. Existing tags are verified to point at the release commit. The workflow does not create a GitHub Release for a version that still needs publish and failed to publish.

## Verify the release

After the workflow succeeds, inspect the published package:

```bash
npm view pi-herdr-roles
```

Test installation through Pi, beside an installed role-free pi-herdr-agents (a peer declaration does not activate an extension):

```bash
pi install npm:pi-herdr-agents
pi install npm:pi-herdr-roles
```

## Troubleshooting

### The workflow ran but did not release

Check the detect job's notice. A private package or a prerelease version is intentionally not released.

### Tag points to another commit

The workflow stops if the matching version tag already points to a different commit. Do not move or reuse release tags. Increment the package version and push a new release commit instead.

### npm rejects authentication

Confirm that the trusted publisher matches owner `giuseppecrj`, repository `pi-herdr-roles`, and workflow `publish.yml`, that the job has `id-token: write`, and that the runner is GitHub-hosted. If a release reports that `NPM_TOKEN` is bootstrap-only, remove the secret and use the trusted publisher.

### npm reports that the version already exists

If the published `gitHead` does not match this commit, the workflow fails before tagging. npm versions are immutable: increment the package version and push a new release commit. If it is a retry of the exact same commit, the workflow skips publish and continues with tag/release.

### Initial branch creation did not release

A first push to a new branch has `github.event.before` all zeroes. The workflow treats that as `release=false`.
