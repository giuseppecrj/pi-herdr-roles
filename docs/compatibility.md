# Compatibility

Status: private Wave 1 candidate. Nothing here is a published compatibility
promise.

## Intended host

The only intended host is the **role-free pi-herdr-agents candidate** produced
by the Wave 1 host extraction: a host that bundles no roles, no `/plan` command
and no top-level `orchestrate` skill. Its exact candidate SHA is recorded by the
parent integration owner when the combined revision vector is tested. Run the
combined checks against it with:

```bash
PI_HERDR_AGENTS_HOST=/path/to/candidate/pi-herdr-agents npm test
```

The `peerDependencies` range `"pi-herdr-agents": "*"` is temporary scaffolding
for local experiments. A publication-compatible minimum must name a released
role-free host and is a later release gate. npm `pi-herdr-agents@2.0.5` predates
Maestro, still bundles these roles and is **not** a supported host.

## Pi runtime

Developed and tested against Pi `1.0.3` (`@earendil-works/pi-coding-agent`
`1.0.3` dev dependency and CLI). Other Pi versions are untested.

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
