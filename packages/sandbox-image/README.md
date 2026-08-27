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
node/bun, ripgrep, jq, `openssh-client`, `procps`, and pinned agent CLIs.

### Pinned build args

Each agent CLI is pinned for reproducible rebuilds; override at build time
with `--build-arg <NAME>=<version>`:

| Build arg | Package |
| --- | --- |
| `CLAUDE_CODE_VERSION` | `@anthropic-ai/claude-code` |
| `CODEX_VERSION` | `@openai/codex` |
| `OPENCODE_VERSION` | `opencode-ai` |
| `GEMINI_CLI_VERSION` | `@google/gemini-cli` |
| `AMP_VERSION` | `@sourcegraph/amp` |
| `COPILOT_VERSION` | `@github/copilot` |
| `MASTRACODE_VERSION` | `mastracode` |

Agents without an official npm package (droid/Factory, cursor-agent, kimi,
grok, vibe, pi/omp) are not bundled — supply a custom `sandbox.image` with
them installed; their host config dirs already mount into the sandbox.

## Publishing

CI publishing to `ghcr.io/superset-sh/sandbox` (multi-arch, with the linux
`superset` CLI baked in) is planned; until then build locally and override
`sandbox.image`.
