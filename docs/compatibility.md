# Compatibility

Status: pi-herdr-roles `0.1.0`, the first public release.

## Host baseline

The compatibility baseline is the published **pi-herdr-agents `3.0.0`**, the
first role-free host release: it bundles no roles, no `/plan` command and no
top-level `orchestrate` skill. The package declares
`"pi-herdr-agents": ">=3.0.0"`; the temporary `"*"` peer ranges used during
the private Wave 1 experiments are gone.

| Component | Tested revision |
| --- | --- |
| pi-herdr-agents | `7d35371` (main at the 3.0.0 line, before its version commit) |
| Pi SDK and CLI | `1.0.3` |

Host versions after 3.0.0 are allowed by the range but were not tested for this
release. Run the combined checks against a host checkout with:

```bash
PI_HERDR_AGENTS_HOST=/path/to/pi-herdr-agents npm test
```

npm `pi-herdr-agents@2.0.5` and earlier predate the extraction, still bundle
these roles and are **not** supported hosts.

## Pi runtime

Developed and tested against Pi `1.0.3` (`@earendil-works/pi-coding-agent`
`1.0.3` dev dependency and CLI). The peer range is `^1.0.3`; other Pi versions
are untested.

## Role-pack protocol

The extension listens synchronously on
`pi-herdr-subagents:roles:discover:v1`, registers `roles/` only for
`apiVersion === 1`, and unsubscribes on `session_shutdown`. It imports no
pi-herdr-agents module. Pi 1.0.3 also drops extension bus listeners on reload
and dispose; the explicit unsubscribe remains required by the protocol and is
tested directly. Roles are package-layer contributions: project and global
definitions override them, and a name contributed by two packs is disabled by
the host.

## Known incompatible combination: hosts that still bundle roles

Observed with pi-herdr-agents `c2177dff835da44937e614e8a03d0405d442e848`
(exported read-only copy) on Pi 1.0.3:

| Host configuration | Observed result |
| --- | --- |
| Default (`roles.bundled` true) | The host rejects all six pack roles with its own `Role pack cannot replace bundled role "<name>"` diagnostics and keeps its bundled copies. |
| `roles.bundled: false` | All six roles list as `package:pi-herdr-roles`. |
| Either | Two `/plan` commands become `/plan:1` (pack) and `/plan:2` (host); bare `/plan` is then sent as literal text. Both packages ship a top-level `orchestrate` skill; Pi keeps the first discovered one. |

`roles.bundled: false` therefore disables only the role layer; it is not a
complete migration. Do not install this pack beside such a host. The pack does
not try to hide or override the host's diagnostics.

## Child sessions

Children launched by pi-herdr-agents load packages from their own Pi settings
scope. Install this pack where child sessions also discover it (normally the
same user settings); a parent-only `pi -e` load is not evidence that children
can resolve `/skill:orchestrate` or these roles. Real child launches are part
of the parent-owned sequential Herdr integration suite and are not exercised by
this package's tests.
