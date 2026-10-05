# pi-herdr-roles

> **Experimental, private, unpublished.** This package is a local Wave 1
> candidate. It is not on npm, has no release, and does not claim compatibility
> with any published pi-herdr-agents version.

An optional Pi role pack for [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents).
It supplies six general-purpose subagent roles plus the `/plan` and
`/skill:orchestrate` workflows that pi-herdr-agents previously bundled. It has
no privileged status: it registers through the same public role-pack protocol
as any other pack, and project or global role definitions still override it.

## Contents

| Resource | Kind | Notes |
| --- | --- | --- |
| `scout` | role | Read-oriented codebase reconnaissance leaf. |
| `planner` | role | Interactive planner; may spawn `scout`. |
| `worker` | role | Implements one complete task; commits only when asked. |
| `reviewer` | role | Evidence-backed leaf reviewer. |
| `adversarial-reviewer` | role | Multi-wave review coordinator that launches `reviewer` children. |
| `visual-tester` | role | **Optional** visual QA; needs the external `chrome-cdp` skill. |
| `/plan <what to build>` | command | Scout → planner → workers → review workflow. |
| `plan` | skill | The same workflow as a native Pi skill (`/skill:plan`). |
| `orchestrate` | skill | Bounded fan-out review with parent synthesis, plus its adversarial procedure and helper. |

Every role a workflow launches ships in this pack. The pack has no dependency
on pi-herdr-pstack.

## Prerequisites and installation

pi-herdr-agents is the execution host. It is declared as a peer dependency, but
**a peer declaration does not activate an extension**: install and enable both
packages through Pi. This package is private and unpublished, so only local-path
experiments are possible today, for example in an isolated agent directory:

```bash
export PI_CODING_AGENT_DIR=/tmp/pi-roles-experiment/agent
pi install /path/to/candidate/pi-herdr-agents
pi install /path/to/pi-herdr-roles
```

Do not install this beside a pi-herdr-agents version that still bundles these
roles or its own `/plan` and `orchestrate`; see
[compatibility](docs/compatibility.md).

Without pi-herdr-agents loaded, `/plan` refuses to start and explains the
missing `subagent` tool. It never falls back to a bare agent or installs
anything.

### Optional `chrome-cdp`

`visual-tester` declares `skills: chrome-cdp` and expects a project-provided
`scripts/cdp.mjs`. Neither this pack nor pi-herdr-agents ships or installs them.
Without them, the role reports a blocked visual test instead of guessing.

## `/plan` delivery

`/plan <task>` reads `skills/plan/SKILL.md` from the installed package, strips
its frontmatter and sends one literal user message:

```text
<skill name="plan" location="/installed/path/skills/plan/SKILL.md">
…skill body…
</skill>

<task>
```

This preserves the former host wrapper exactly. It does not rely on slash-text
expansion. `/skill:plan` uses Pi's native skill expansion instead.

## Worktree guidance

pi-herdr-agents no longer warns about specific role names. The equivalent
recommendations now live with the roles:

- `scout` and `reviewer` are read-oriented and normally do not need a new
  worktree. Use an ordinary pane; to inspect an existing worker result, start
  them in the retained worktree path.
- `adversarial-reviewer` coordinates read-oriented reviewers and does not write
  artifacts in the reviewed checkout. It normally uses an ordinary pane.
- Herdr worktree workspaces persist until explicitly removed.

A `read, bash` allowlist is **not** read-only: Bash can modify files. These
are role conventions, not a sandbox.

## Development

```bash
npm install          # .npmrc disables automatic peer installation
npm run check        # typecheck, lint, format:check, test
```

Tests use only test-owned temporary agent, home and project directories, the
pinned `@earendil-works/pi-coding-agent@1.0.3` dev dependency CLI, and a
deterministic offline faux provider. They never edit your Pi settings.

| Variable | Effect |
| --- | --- |
| `PI_HERDR_AGENTS_HOST` | Role-free host package root for combined-host RPC checks; role-free expectations always apply, so a legacy bundled host fails. Skipped when unset. |
| `PI_HERDR_AGENTS_LEGACY_HOST` | Opt-in pre-extraction host root for separate legacy bundled-role characterization; skipped when unset. |
| `PI_HERDR_AGENTS_SOURCE` | pi-herdr-agents Git checkout for byte-level provenance reconstruction. Defaults to a sibling `../pi-herdr-agents` when it contains the source commit; skipped otherwise. |
| `PI_BIN` | Alternative Pi executable for RPC tests. |

The faux provider only drives tool calls deterministically. Passing tests are
not evidence that a live model follows the role or skill prose.

The review evaluation corpus moved with the workflow; see
[review evaluation](docs/review-evaluation.md).

## Provenance and license

Moved files and their exact source revision are listed in
[provenance](docs/provenance.md). MIT; see [LICENSE](LICENSE) and
[third-party notices](THIRD_PARTY_NOTICES.md).
