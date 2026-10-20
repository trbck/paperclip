# Dev Project Access

This repo includes a repeatable bootstrap for giving Paperclip companies access
to local development repos mounted into the Paperclip Docker container.

The first mapping is:

- Company selector: `Quant` / `quant` (no such company exists in the live instance as of 2026-10-20; pick a live company before applying)
- Project: `ttengine`
- Workspace path: `/home/trbck/workspace/ttengine`
- GitHub repo: `trbck/ttengine`
- Push policy: feature branches only
- Runtime access: full `host-run` access

## Why This Shape

Paperclip already has company-scoped Projects, Project Workspaces, execution
workspace policy, runtime commands, and activity logging. The safest operational
path is to use those existing APIs instead of bind-mounting more host state or
editing the Paperclip database directly.

The bootstrap has two phases:

1. Render and review the payload offline.
2. Apply it through the authenticated Paperclip API with a board API key.

Credentials are never stored in the config file.

## Render The Payload

```sh
node scripts/dev-project-access/render-dev-project-access.mjs --mapping quant-ttengine
node scripts/dev-project-access/render-dev-project-access.mjs --mapping quant-ttengine --json
```

The renderer validates that `/home/trbck/workspace/ttengine` exists, probes the
Git remote/branch, and prints the Project and Project Workspace payloads.

## Apply To The Live Instance

The live Docker instance at `http://127.0.0.1:3100` is authenticated/private, so
mutations require board authorization.

```sh
PAPERCLIP_API_KEY=pcp_... \
  node scripts/dev-project-access/apply-dev-project-access.mjs \
  --mapping quant-ttengine \
  --api-base http://127.0.0.1:3100 \
  --yes
```

Without `--yes`, the apply script is a dry run. Without `PAPERCLIP_API_KEY`, it
refuses to make API requests.

## Runtime Commands

The generated workspace runtime contains shared services for:

- `Engine API` on `127.0.0.1:18088`
- `Frontend Vite` on `127.0.0.1:5173`

It also contains jobs for:

- Git status
- Create a timestamped feature branch
- Push the current feature branch
- Go short tests
- Frontend tests
- `make prod-verify-q`
- `make q-dev`
- `make prod-deploy-q`
- Engine status API probe
- Host Docker status
- Host systemd status

These commands run through `host-run`, which enters the host namespaces from the
Paperclip container. The Quant mapping intentionally grants full host runtime
access because that was the selected policy for this workspace.

## Git Policy

Agents may edit code in the workspace and push feature branches. They must not
push directly to `main`, `master`, `prod`, or `production`.

The generated project execution policy uses isolated Git worktrees under:

```text
/home/trbck/workspace/ttengine/.paperclip/worktrees
```

That lets issue work happen on feature branches while the primary workspace
continues to represent the local repo.

## Adding Another Company/Repo

Add another entry to `scripts/dev-project-access/config.json` with:

- `company.selector.names` and/or `company.selector.issuePrefixes`
- `project` name/description
- `workspace.cwd`, `workspace.repoUrl`, and `workspace.sharedWorkspaceKey`
- `gitPolicy`
- `accessPolicy`

Then render it:

```sh
node scripts/dev-project-access/render-dev-project-access.mjs --mapping <id>
```
