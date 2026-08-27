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

`.github/workflows/publish-sandbox-image.yml` builds and pushes the multi-arch
image to `ghcr.io/superset-sh/sandbox:latest` on every push to `main` that
touches this package (or via manual `workflow_dispatch`). That is the default
`sandbox.image` for non-development hosts. For local development the runtime
defaults to the locally built `superset-sandbox:dev` instead, so a published
image isn't required to dogfood.
