# Pull Request Previews

Add one GitHub Action and every browser-compatible Docker Compose pull request
receives a static, shareable Cloudflare Pages preview.

The same Action produces a visible compatibility report for partial or blocked
stacks. That report is deliberately **not** presented as an application preview,
and the check fails until every active service has a browser adapter.

## Before you start

You need:

- a repository containing a single Compose file, such as `compose.yaml`;
- an existing Cloudflare Pages **Direct Upload** project;
- the Cloudflare account ID;
- a scoped Cloudflare API token with permission to edit Pages projects.

Create the Pages project in the Cloudflare dashboard or with Wrangler. The
project name becomes the `cloudflare-project` input and must use letters,
numbers, and hyphens.

Add these repository Actions secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account that owns the Pages project. |
| `CLOUDFLARE_API_TOKEN` | Deploys generated static files. Scope it to Pages edit access for the intended account. |

## Add one workflow

Create `.github/workflows/pocketstack.yml`:

```yaml
name: PocketStack Preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: read
  pull-requests: write

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: ramazankara/pocketstack@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          compose-file: compose.yaml
          cloudflare-project: my-app-previews
          cloudflare-account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

That is the complete job. The composite Action checks out the pull request,
sets up Go, builds the trusted PocketStack CLI from the Action revision, runs
the analyzer with repository path confinement, and calls a pinned Wrangler
version for deployment.

Use `@v1` to receive compatible v1 updates. Use a release such as `@v1.2.0`, or
an exact commit SHA, when your organization requires immutable Action pins.

## What happens on a pull request

```text
Compose PR
    │
    ├─ every active service has an adapter ── generate ── deploy app ── pass
    │
    └─ partial, blocked, or invalid ───────── report ──── deploy report ─ fail
```

For same-repository pull requests, each PR number gets a stable Cloudflare
branch alias:

```text
https://pr-184.my-app-previews.pages.dev
```

Every synchronization replaces the content behind that alias. PocketStack also
writes the GitHub job summary and creates or updates one sticky PR comment. It
does not add a new comment for each commit.

When the pull request closes, the Action replaces the alias with a static
closed-preview tombstone. This prevents the stable URL from continuing to show
an apparently current application. Cloudflare may retain immutable deployment
history according to the project’s retention settings.

## Ready, partial, and blocked

| Status | Meaning | App preview | Static report | Check |
| --- | --- | --- | --- | --- |
| `ready` | Every active service maps to a browser adapter. | Yes | Job summary and PR comment | Pass |
| `partial` | At least one service maps and at least one does not. | No | Yes | Fail |
| `blocked` | The stack cannot generate a browser-native app. | No | Yes | Fail |
| `error` | Analysis, generation, or deployment failed. | No | When credentials and deployment are available | Fail |

The compatibility report lists each service, its adapter or image, unsupported
reasons, and suggested conversions. A report URL is evidence that deployment
was blocked; it is not a remote container environment.

## Inputs

| Input | Required for deployment | Default | Description |
| --- | --- | --- | --- |
| `github-token` | For PR comments | none | Usually <code v-pre>${{ secrets.GITHUB_TOKEN }}</code>. The job summary works without it. |
| `compose-file` | Yes | `compose.yaml` | Path relative to the repository root. Absolute and escaping paths are rejected. |
| `cloudflare-project` | Yes | none | Existing Cloudflare Pages Direct Upload project. |
| `cloudflare-account-id` | Yes | none | Cloudflare account ID. |
| `cloudflare-api-token` | Yes | none | Scoped token with Pages edit access. |

The three Cloudflare inputs are intentionally not marked as required in Action
metadata because secrets are unavailable to fork and Dependabot pull requests.
For a normal same-repository ready PR, missing deployment configuration fails
the Action instead of claiming a preview exists.

## Outputs

Give the Action step an `id` to consume outputs in later steps:

```yaml
- id: pocketstack
  uses: ramazankara/pocketstack@v1
  with:
    # inputs omitted

- if: always()
  run: |
    echo "status=${{ steps.pocketstack.outputs.readiness-status }}"
    echo "score=${{ steps.pocketstack.outputs.readiness-score }}"
    echo "preview=${{ steps.pocketstack.outputs.preview-url }}"
```

| Output | Value |
| --- | --- |
| `readiness-status` | `ready`, `partial`, `blocked`, `error`, or `closed` |
| `readiness-score` | Percentage of active services that map to adapters |
| `preview-url` | Stable alias, set only for a ready, deployed application preview |
| `deployment-url` | Immutable Cloudflare deployment URL when Wrangler returns one |

## Forks and Dependabot

GitHub does not expose repository deployment secrets to untrusted fork code.
PocketStack preserves that boundary:

- compatibility analysis still runs;
- no Cloudflare deployment is attempted;
- no PR comment is attempted;
- the job summary explains why deployment was skipped;
- a compatible fork can pass the readiness check, but it receives no URL.

Dependabot is treated the same way because repository secrets are unavailable
to its pull-request workflows by default.

## Security model

Use the `pull_request` event shown above. Do not convert this workflow to
`pull_request_target`: that event can expose base-repository credentials while
operating on untrusted pull-request data.

The Action:

- never starts Docker or a container image;
- does not run project package scripts in the GitHub runner;
- builds the PocketStack CLI from the selected Action revision, not the PR;
- requires the Compose file to remain inside `GITHUB_WORKSPACE`;
- rejects bind mounts, `env_file` entries, label paths, and symlinks that escape
  the checked-out repository;
- caps and escapes untrusted service data before rendering HTML or Markdown;
- deploys only generated static output;
- skips deployments and writable comments for forks and Dependabot.

The `frontend` adapter can run project package scripts later, inside an
isolated browser WebContainer after a preview visitor explicitly starts the
demo. That code does not run in GitHub Actions or on a PocketStack server.

Grant the Cloudflare token only the access it needs, protect repository secrets,
and pin the Action according to your dependency policy.

## Hosting requirements

The `frontend` and `wasi` adapters require cross-origin
isolation. PocketStack emits a `_headers` file with COOP/COEP headers, and
Cloudflare Pages applies it to the static deployment. Other hosts must support
equivalent response headers. See [hosting and headers](/deploy/hosting).

## Troubleshooting

**The Action says deployment is not configured.** Check all three Cloudflare
inputs and confirm the project already exists.

**The compatibility check fails.** Open the report or job summary. Convert or
remove every unsupported active service; see the [conversion guide](/convert/).

**The report is ready but the PR has no comment.** Ensure the workflow grants
`pull-requests: write` and passes `github-token`. The job summary remains the
source of truth if comment creation fails.

**A previous preview still appears after a failed deployment.** A Cloudflare
failure can leave the older stable alias visible. The Action calls this out in
the summary and comment; rerun after fixing credentials or the Cloudflare
incident.
