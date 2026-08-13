# @superset/sandbox-image

Default Docker image for Superset sandboxed workspaces (the `sandbox` key
in `.superset/config.json`).

## Local build

```bash
bun run --cwd packages/sandbox-image build:image
```

then point a project at it (machine-local config, e.g.
`.superset/config.local.json`):

```json
{
  "sandbox": {
    "enabled": true,
    "image": "superset-sandbox:dev"
  }
}
```

## Image contract

Any image used as `sandbox.image` must provide `/bin/bash`, `git`, `curl`,
CA certificates, and a `sleep` binary. The default image additionally ships
node/bun, ripgrep, jq, and pinned Claude Code + Codex CLIs (see build args
`CLAUDE_CODE_VERSION` / `CODEX_VERSION`).

## Publishing

CI publishing to `ghcr.io/superset-sh/sandbox` (multi-arch, with the linux
`superset` CLI baked in) is planned; until then build locally and override
`sandbox.image`.
