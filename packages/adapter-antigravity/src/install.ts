import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

let _dryRun = false;

function log(msg: string): void {
  console.log(msg);
}

function doWrite(filePath: string, content: string): void {
  if (_dryRun) {
    log(`[DRY-RUN] Would write: ${filePath}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  log(`  Wrote: ${filePath}`);
}

function doCopy(src: string, dst: string, skipExisting = false): void {
  if (skipExisting && fs.existsSync(dst)) {
    log(`  Skip: ${dst} (already exists)`);
    return;
  }
  if (_dryRun) {
    log(`[DRY-RUN] Would copy: ${src} → ${dst}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  log(`  Copied: ${src} → ${dst}`);
}

function renderString(content: string, pluginRoot: string): string {
  content = content.replace(/\{PLUGIN_ROOT\}/g, pluginRoot);
  content = content.replace(/\{PYTHON\}/g, process.execPath);
  return content;
}

function renderTemplate(src: string, dst: string, pluginRoot: string): void {
  if (!fs.existsSync(src)) {
    return;
  }
  const content = renderString(fs.readFileSync(src, "utf-8"), pluginRoot);
  api.doWrite(dst, content);
}

function renderAllTemplates(pluginRoot: string): void {
  const templates: [string, string][] = [
    [path.join(pluginRoot, "conf", "templates", "hooks.template.json"), path.join(pluginRoot, "hooks.json")],
    [path.join(pluginRoot, "conf", "templates", "sidecar.template.json"), path.join(pluginRoot, "sidecars", "memory-compactor", "sidecar.json")],
    [path.join(pluginRoot, "conf", "templates", "SKILL.template.md"), path.join(pluginRoot, "skills", "remora-architecture", "SKILL.md")],
  ];

  const agentsDir = path.join(pluginRoot, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith(".template.json")) {
        templates.push([path.join(agentsDir, f), path.join(agentsDir, f.replace(".template.json", ".json"))]);
      }
    }
  }

  log("\n[1/4] Rendering templates...");
  for (const [src, dst] of templates) {
    api.renderTemplate(src, dst, pluginRoot);
  }
}

function deployWorkflows(pluginRoot: string): void {
  const configDir = path.join(os.homedir(), ".gemini", "config");
  const workflowsSrc = path.join(pluginRoot, "global_workflows");
  const workflowsDst = path.join(configDir, "global_workflows");

  if (!fs.existsSync(workflowsSrc)) {
    return;
  }

  log("\n[2/4] Deploying workflows...");
  for (const f of fs.readdirSync(workflowsSrc).sort()) {
    if (!f.endsWith(".md")) {
      continue;
    }
    const src = path.join(workflowsSrc, f);
    const dst = path.join(workflowsDst, f);
    const content = renderString(fs.readFileSync(src, "utf-8"), pluginRoot);
    api.doWrite(dst, content);
  }
}

function initDatabase(pluginRoot: string, dataDir: string): void {
  log("\n[3/4] Initializing database schema...");
  const schemaScript = path.join(pluginRoot, "scripts", "schema", "schema_init.py");
  const dbPath = path.join(dataDir, "remora_memory.db");

  fs.mkdirSync(dataDir, { recursive: true });

  if (_dryRun) {
    log(`[DRY-RUN] Would run: ${schemaScript} with REMORA_DB_PATH=${dbPath}`);
    return;
  }

  execSync(
    `${process.execPath} ${schemaScript}`,
    { env: { ...process.env, REMORA_DB_PATH: dbPath } },
  );
  log(`  DB initialized: ${dbPath}`);
}

function runQualityGate(pluginRoot: string): void {
  log("Running quality gate...");
  try {
    execSync(
      `${process.execPath} -m unittest scripts.tests.test_quality_gate`,
      { cwd: pluginRoot },
    );
  } catch {
    log("FATAL: Quality gate failed. Installation aborted.");
    process.exit(1);
  }
}

function resolvePaths(pluginRoot: string): [string, string] {
  let dataDir: string;
  try {
    fs.accessSync(pluginRoot, fs.constants.W_OK);
    dataDir = path.join(pluginRoot, "data");
  } catch {
    dataDir = path.join(os.homedir(), ".remora", "data");
  }
  const runtimeDir = path.join(dataDir, ".runtime");
  return [dataDir, runtimeDir];
}

function doRemove(filePath: string): void {
  if (_dryRun) {
    log(`[DRY-RUN] Would remove: ${filePath}`);
    return;
  }
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    log(`  Removed: ${filePath}`);
  }
}

function doUninstall(dataDir: string, pluginRoot: string): void {
  log("Uninstalling Remora Plugin...");

  const flag = path.join(dataDir, ".runtime", "installed.flag");
  api.doRemove(flag);

  const rendered = [
    "hooks.json",
    "sidecars/memory-compactor/sidecar.json",
    "skills/remora-architecture/SKILL.md",
  ];
  for (const rel of rendered) {
    const target = path.join(pluginRoot, rel);
    api.doRemove(target);
  }

  const agentsDir = path.join(pluginRoot, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir)) {
      if (f.endsWith(".json") && !f.endsWith(".template.json")) {
        api.doRemove(path.join(agentsDir, f));
      }
    }
  }

  log("Uninstall complete. Database and workflows preserved.");
}

function mainReal(
  pluginRoot: string,
  dataDir: string,
  runtimeDir: string,
  force = false,
  dryRunParam = false,
  uninstall = false,
): void {
  const flagPath = path.join(runtimeDir, "installed.flag");

  if (uninstall) {
    api.doUninstall(dataDir, pluginRoot);
    return;
  }

  _dryRun = dryRunParam;

  if (fs.existsSync(flagPath) && !force && !_dryRun) {
    log("Remora is already installed. Use --force to reinstall.");
    return;
  }

  api.runQualityGate(pluginRoot);
  api.renderAllTemplates(pluginRoot);
  api.deployWorkflows(pluginRoot);
  api.initDatabase(pluginRoot, dataDir);

  log("\n[4/4] Finalizing...");
  api.doWrite(flagPath, "installed");

  log("\nInstallation complete.");
  log("Set REMORA_DB_PATH env var to customize database location.");
  log(`Current DB path: ${path.join(dataDir, "remora_memory.db")}`);
}

function main(): void {
  const argv = process.argv.slice(2);
  let force = false;
  let dryRunFlag = false;
  let uninstall = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--dry-run") {
      dryRunFlag = true;
    } else if (arg === "--uninstall") {
      uninstall = true;
    }
  }

  const pluginRoot = path.resolve(__dirname);
  const [dataDir, runtimeDir] = api.resolvePaths(pluginRoot);

  api.mainReal(pluginRoot, dataDir, runtimeDir, force, dryRunFlag, uninstall);
}

const api = {
  get dryRun(): boolean {
    return _dryRun;
  },
  set dryRun(v: boolean) {
    _dryRun = v;
  },
  log,
  doWrite,
  doCopy,
  renderString,
  renderTemplate,
  renderAllTemplates,
  deployWorkflows,
  initDatabase,
  runQualityGate,
  resolvePaths,
  doRemove,
  doUninstall,
  mainReal,
  main,
};

export default api;
