import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const defaultConfigPath = path.join(__dirname, "config.json");

export function parseArgs(argv) {
  const args = {
    config: defaultConfigPath,
    mapping: "quant-ttengine",
    apiBase: process.env.PAPERCLIP_API_BASE || "http://127.0.0.1:3100",
    apiKey: process.env.PAPERCLIP_API_KEY || "",
    yes: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") args.config = requireValue(argv, ++index, arg);
    else if (arg === "--mapping") args.mapping = requireValue(argv, ++index, arg);
    else if (arg === "--api-base") args.apiBase = requireValue(argv, ++index, arg);
    else if (arg === "--api-key") args.apiKey = requireValue(argv, ++index, arg);
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function loadMapping(configPath, mappingId) {
  const absolutePath = path.resolve(configPath);
  const config = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (config.version !== 1) {
    throw new Error(`Unsupported config version in ${absolutePath}`);
  }
  const mapping = config.mappings?.find((entry) => entry.id === mappingId);
  if (!mapping) {
    const known = (config.mappings ?? []).map((entry) => entry.id).join(", ");
    throw new Error(`Mapping "${mappingId}" not found. Known mappings: ${known || "(none)"}`);
  }
  return { configPath: absolutePath, mapping };
}

export function buildAccessPlan(mapping) {
  const workspace = mapping.workspace;
  const cwd = workspace.cwd;
  validateWorkspacePath(cwd);

  const actualGitRemote = readGit(cwd, ["config", "--get", "remote.origin.url"], { optional: true });
  const currentBranch = readGit(cwd, ["branch", "--show-current"], { optional: true });
  const headSha = readGit(cwd, ["rev-parse", "--short", "HEAD"], { optional: true });
  const statusLines = readGit(cwd, ["status", "--short"], { optional: true })
    .split("\n")
    .filter(Boolean);

  const workspaceRuntime = buildWorkspaceRuntime(mapping);
  const projectPayload = {
    name: mapping.project.name,
    description: mapping.project.description,
    status: mapping.project.status,
    color: mapping.project.color,
    executionWorkspacePolicy: buildExecutionWorkspacePolicy(mapping, workspaceRuntime)
  };
  const workspacePayload = {
    name: workspace.name,
    sourceType: workspace.sourceType,
    cwd: workspace.cwd,
    repoUrl: workspace.repoUrl,
    repoRef: workspace.repoRef,
    defaultRef: workspace.defaultRef,
    sharedWorkspaceKey: workspace.sharedWorkspaceKey,
    visibility: workspace.visibility,
    isPrimary: workspace.isPrimary,
    metadata: {
      managedBy: "scripts/dev-project-access",
      mappingId: mapping.id,
      actualGitRemote,
      gitPolicy: mapping.gitPolicy,
      accessPolicy: mapping.accessPolicy
    },
    runtimeConfig: {
      workspaceRuntime,
      desiredState: "manual"
    }
  };

  return {
    mappingId: mapping.id,
    companySelector: mapping.company.selector,
    repoProbe: {
      cwd,
      exists: true,
      actualGitRemote,
      configuredRepoUrl: workspace.repoUrl,
      currentBranch,
      headSha,
      dirtyEntryCount: statusLines.length
    },
    gitPolicy: mapping.gitPolicy,
    accessPolicy: mapping.accessPolicy,
    projectPayload,
    workspacePayload,
    applySequence: [
      "GET /api/companies",
      "GET /api/companies/{companyId}/projects",
      "POST or PATCH /api/projects",
      "POST or PATCH /api/projects/{projectId}/workspaces",
      "PATCH /api/projects/{projectId} with defaultProjectWorkspaceId"
    ]
  };
}

function validateWorkspacePath(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new Error("Mapping workspace.cwd is required");
  }
  if (!existsSync(cwd)) {
    throw new Error(`Workspace path does not exist: ${cwd}`);
  }
  const stat = statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${cwd}`);
  }
}

function readGit(cwd, args, options = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    if (options.optional) return "";
    throw error;
  }
}

function buildExecutionWorkspacePolicy(mapping, workspaceRuntime) {
  const policy = mapping.gitPolicy;
  return {
    enabled: true,
    defaultMode: "isolated_workspace",
    allowIssueOverride: true,
    workspaceStrategy: {
      type: "git_worktree",
      baseRef: `origin/${policy.baseBranch}`,
      branchTemplate: policy.branchTemplate,
      worktreeParentDir: policy.worktreeParentDir
    },
    workspaceRuntime,
    branchPolicy: {
      pushPolicy: policy.pushPolicy,
      baseBranch: policy.baseBranch,
      forbidDirectBranches: policy.forbidDirectBranches
    },
    runtimePolicy: {
      hostRun: mapping.accessPolicy.hostRun,
      canStartServices: mapping.accessPolicy.canStartServices,
      canRunDeploymentCommands: mapping.accessPolicy.canRunDeploymentCommands
    }
  };
}

function buildWorkspaceRuntime(mapping) {
  const envPrefix = hostEnvPrefix(mapping.hostRuntime?.env ?? {});
  const run = (command) => `host-run ${envPrefix} bash -lc ${shellQuote(command)}`;
  const repoCwd = ".";

  return {
    commands: [
      {
        id: "service:engine-api",
        name: "Engine API",
        kind: "service",
        lifecycle: "shared",
        cwd: repoCwd,
        command: run("make build && exec ./bin/engine-api"),
        port: 18088,
        expose: { urlTemplate: "http://127.0.0.1:18088/healthz" },
        readiness: {
          type: "http",
          urlTemplate: "http://127.0.0.1:18088/healthz",
          timeoutSec: 90
        }
      },
      {
        id: "service:frontend",
        name: "Frontend Vite",
        kind: "service",
        lifecycle: "shared",
        cwd: repoCwd,
        command: run("cd frontend && exec npm run dev -- --host 127.0.0.1 --port 5173"),
        port: 5173,
        expose: { urlTemplate: "http://127.0.0.1:5173/terminal/" },
        readiness: {
          type: "http",
          urlTemplate: "http://127.0.0.1:5173/terminal/",
          timeoutSec: 90
        }
      },
      {
        id: "job:git-status",
        name: "Git status",
        kind: "job",
        cwd: repoCwd,
        command: run("git status --short --branch && git remote -v")
      },
      {
        id: "job:create-feature-branch",
        name: "Create feature branch",
        kind: "job",
        cwd: repoCwd,
        command: run("set -euo pipefail; branch=\"${PAPERCLIP_FEATURE_BRANCH:-paperclip/$(date +%Y%m%d-%H%M%S)-ttengine}\"; case \"$branch\" in main|master|prod|production) echo \"refusing protected branch $branch\" >&2; exit 2;; esac; git fetch origin main; git checkout -B \"$branch\" origin/main; git status --short --branch")
      },
      {
        id: "job:push-feature-branch",
        name: "Push feature branch",
        kind: "job",
        cwd: repoCwd,
        command: run("set -euo pipefail; branch=$(git branch --show-current); test -n \"$branch\"; case \"$branch\" in main|master|prod|production) echo \"refusing to push protected branch $branch\" >&2; exit 2;; esac; git push -u origin \"$branch\"")
      },
      {
        id: "job:test-go-short",
        name: "Go short tests",
        kind: "job",
        cwd: repoCwd,
        command: run("make test")
      },
      {
        id: "job:frontend-test",
        name: "Frontend tests",
        kind: "job",
        cwd: repoCwd,
        command: run("cd frontend && npm run test")
      },
      {
        id: "job:prod-verify-q",
        name: "Verify q.betterquants dev surface",
        kind: "job",
        cwd: repoCwd,
        command: run("make prod-verify-q")
      },
      {
        id: "job:q-dev",
        name: "Apply q dev wiring",
        kind: "job",
        cwd: repoCwd,
        command: run("make q-dev")
      },
      {
        id: "job:prod-deploy-q",
        name: "Deploy q surface",
        kind: "job",
        cwd: repoCwd,
        command: run("make prod-deploy-q")
      },
      {
        id: "job:engine-status",
        name: "Engine status API",
        kind: "job",
        cwd: repoCwd,
        command: run("curl -fsS --max-time 10 http://127.0.0.1:18088/api/engine/status | jq '{status, subscriber, broker, runtime}'")
      },
      {
        id: "job:docker-status",
        name: "Host Docker status",
        kind: "job",
        cwd: repoCwd,
        command: run("docker ps | grep -E 'ttengine|questdb|postgres|redis' || true")
      },
      {
        id: "job:systemd-status",
        name: "Host systemd status",
        kind: "job",
        cwd: repoCwd,
        command: run("systemctl --no-pager --full status ttengine-api.service ttengine-subscriber.service nginx || true")
      }
    ]
  };
}

function hostEnvPrefix(env) {
  const entries = Object.entries(env).filter(([, value]) => typeof value === "string" && value.length > 0);
  if (entries.length === 0) return "";
  return `env ${entries.map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ")}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function printPlanSummary(plan) {
  const commands = plan.workspacePayload.runtimeConfig.workspaceRuntime.commands;
  const serviceCount = commands.filter((command) => command.kind === "service").length;
  const jobCount = commands.filter((command) => command.kind === "job").length;
  console.log(`mapping: ${plan.mappingId}`);
  console.log(`company selector: ${selectorSummary(plan.companySelector)}`);
  console.log(`workspace: ${plan.repoProbe.cwd}`);
  console.log(`git remote: ${plan.repoProbe.actualGitRemote || "(not detected)"}`);
  console.log(`current branch: ${plan.repoProbe.currentBranch || "(not detected)"}`);
  console.log(`dirty entries: ${plan.repoProbe.dirtyEntryCount}`);
  console.log(`push policy: ${plan.gitPolicy.pushPolicy}`);
  console.log(`host-run access: ${plan.accessPolicy.hostRun}`);
  console.log(`runtime commands: ${serviceCount} services, ${jobCount} jobs`);
}

function selectorSummary(selector) {
  const names = selector.names?.join("|") || "";
  const prefixes = selector.issuePrefixes?.join("|") || "";
  return [names && `names=${names}`, prefixes && `issuePrefixes=${prefixes}`].filter(Boolean).join(", ");
}

export function findCompany(companies, selector) {
  const names = new Set((selector.names ?? []).map(normalize));
  const prefixes = new Set((selector.issuePrefixes ?? []).map(normalize));
  return companies.find((company) =>
    names.has(normalize(company.name)) || prefixes.has(normalize(company.issuePrefix))
  ) ?? null;
}

export function findProject(projects, projectPayload) {
  const targetName = normalize(projectPayload.name);
  const targetUrlKey = slug(projectPayload.name);
  return projects.find((project) =>
    normalize(project.name) === targetName || normalize(project.urlKey) === targetUrlKey
  ) ?? null;
}

export function findWorkspace(workspaces, workspacePayload) {
  return workspaces.find((workspace) =>
    workspace.sharedWorkspaceKey === workspacePayload.sharedWorkspaceKey ||
    normalize(workspace.name) === normalize(workspacePayload.name) ||
    workspace.cwd === workspacePayload.cwd
  ) ?? null;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function slug(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
