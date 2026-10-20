#!/usr/bin/env node
import {
  buildAccessPlan,
  findCompany,
  findProject,
  findWorkspace,
  loadMapping,
  parseArgs,
  printPlanSummary
} from "./lib.mjs";

function printHelp() {
  console.log(`Usage: node scripts/dev-project-access/apply-dev-project-access.mjs [options]

Options:
  --mapping <id>       Mapping id to apply (default: quant-ttengine)
  --config <path>      Config file (default: scripts/dev-project-access/config.json)
  --api-base <url>     Paperclip API base (default: PAPERCLIP_API_BASE or http://127.0.0.1:3100)
  --api-key <token>    Board API key (default: PAPERCLIP_API_KEY)
  --yes                Mutate the live Paperclip instance. Without this, dry-run only.
  --json               Print JSON result
  --help               Show this help

The script never reads credentials from the config file and refuses live writes
without a board API key plus --yes.
`);
}

class ApiClient {
  constructor({ apiBase, apiKey }) {
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = payload?.error || payload?.message || text || `HTTP ${response.status}`;
      throw new Error(`${method} ${path} failed: ${message}`);
    }
    return payload;
  }

  get(path) {
    return this.request("GET", path);
  }

  post(path, body) {
    return this.request("POST", path, body);
  }

  patch(path, body) {
    return this.request("PATCH", path, body);
  }
}

async function applyPlan(args, plan) {
  if (!args.yes) {
    return {
      dryRun: true,
      message: "Dry run only. Re-run with --yes to mutate the live Paperclip instance.",
      plan
    };
  }
  if (!args.apiKey) {
    throw new Error("PAPERCLIP_API_KEY or --api-key is required for live apply");
  }

  const api = new ApiClient(args);
  const companies = await api.get("/api/companies");
  const company = findCompany(companies ?? [], plan.companySelector);
  if (!company) {
    throw new Error(
      `No company matched selector ${JSON.stringify(plan.companySelector)}. Create/select the company first, then rerun.`
    );
  }

  const projects = await api.get(`/api/companies/${encodeURIComponent(company.id)}/projects`);
  let project = findProject(projects ?? [], plan.projectPayload);
  const projectAction = project ? "updated" : "created";
  if (project) {
    project = await api.patch(`/api/projects/${encodeURIComponent(project.id)}`, plan.projectPayload);
  } else {
    project = await api.post(`/api/companies/${encodeURIComponent(company.id)}/projects`, plan.projectPayload);
  }

  const workspaces = await api.get(`/api/projects/${encodeURIComponent(project.id)}/workspaces`);
  let workspace = findWorkspace(workspaces ?? [], plan.workspacePayload);
  const workspaceAction = workspace ? "updated" : "created";
  if (workspace) {
    workspace = await api.patch(
      `/api/projects/${encodeURIComponent(project.id)}/workspaces/${encodeURIComponent(workspace.id)}`,
      plan.workspacePayload
    );
  } else {
    workspace = await api.post(`/api/projects/${encodeURIComponent(project.id)}/workspaces`, plan.workspacePayload);
  }

  const projectPolicy = {
    ...plan.projectPayload.executionWorkspacePolicy,
    defaultProjectWorkspaceId: workspace.id
  };
  project = await api.patch(`/api/projects/${encodeURIComponent(project.id)}`, {
    executionWorkspacePolicy: projectPolicy
  });

  return {
    dryRun: false,
    company: { id: company.id, name: company.name },
    project: { id: project.id, name: project.name, action: projectAction },
    workspace: { id: workspace.id, name: workspace.name, action: workspaceAction },
    runtimeCommandCount: plan.workspacePayload.runtimeConfig.workspaceRuntime.commands.length
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const { mapping } = loadMapping(args.config, args.mapping);
  const plan = buildAccessPlan(mapping);
  if (!args.yes && !args.json) {
    printPlanSummary(plan);
  }
  const result = await applyPlan(args, plan);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.dryRun) {
    console.log(result.message);
  } else {
    console.log(`company: ${result.company.name} (${result.company.id})`);
    console.log(`project: ${result.project.action} ${result.project.name} (${result.project.id})`);
    console.log(`workspace: ${result.workspace.action} ${result.workspace.name} (${result.workspace.id})`);
    console.log(`runtime commands: ${result.runtimeCommandCount}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
