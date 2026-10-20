#!/usr/bin/env node
import {
  buildAccessPlan,
  loadMapping,
  parseArgs,
  printPlanSummary
} from "./lib.mjs";

function printHelp() {
  console.log(`Usage: node scripts/dev-project-access/render-dev-project-access.mjs [options]

Options:
  --mapping <id>   Mapping id to render (default: quant-ttengine)
  --config <path>  Config file (default: scripts/dev-project-access/config.json)
  --json           Print full JSON payload
  --help           Show this help
`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const { mapping } = loadMapping(args.config, args.mapping);
  const plan = buildAccessPlan(mapping);
  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printPlanSummary(plan);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
