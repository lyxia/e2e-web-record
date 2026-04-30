import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";

type PackageJson = {
  version?: string;
};

const rootDir = path.resolve(__dirname, "..");
const skillDir = path.join(rootDir, "dist", "skills", "react-component-upgrade");
const skillScriptsDir = path.join(skillDir, "scripts");
const workflowDistDir = path.join(skillScriptsDir, "workflow");
const recorderDistDir = path.join(skillScriptsDir, "recorder");
const panelDistDir = path.join(skillScriptsDir, "panel");

function run(command: string, args: string[]): void {
  const display = [command].concat(args).join(" ");
  console.log("$ " + display);
  childProcess.execFileSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function copyFile(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function renderSkillTemplate(): void {
  const coverageMarkerPackage = readJson<PackageJson>(
    path.join(rootDir, "packages", "coverage-marker", "package.json")
  );
  if (!coverageMarkerPackage.version) {
    throw new Error("packages/coverage-marker/package.json is missing version");
  }

  const templatePath = path.join(rootDir, "skill-template", "SKILL.md.tpl");
  const template = fs.readFileSync(templatePath, "utf8");
  const rendered = template.replace(
    /\{\{coverageMarkerVersion\}\}/g,
    coverageMarkerPackage.version
  );

  if (rendered.indexOf("@your-org") !== -1) {
    throw new Error("Rendered SKILL.md contains @your-org placeholder");
  }

  fs.writeFileSync(path.join(skillDir, "SKILL.md"), rendered);
}

function copySubagentPrompts(): void {
  const promptsTemplate = path.join(rootDir, "skill-template", "subagent-prompts.md.tpl");
  if (!fs.existsSync(promptsTemplate)) {
    throw new Error("skill-template/subagent-prompts.md.tpl missing");
  }
  const text = fs.readFileSync(promptsTemplate, "utf8");
  fs.writeFileSync(path.join(skillDir, "subagent-prompts.md"), text);
}

function buildWorkflowScripts(): void {
  run("yarn", ["workspace", "scan", "build"]);
  run("yarn", ["workspace", "workflow", "build"]);

  const mappings: Array<[string, string]> = [
    ["resume.js", "resume.js"],
    ["run-scan.js", "scan.js"],
    ["api-diff.js", "api-diff.js"],
    ["after-runtime-plan.js", "after-runtime-plan.js"],
    ["report.js", "report.js"],
  ];
  for (const [src, dst] of mappings) {
    copyFile(
      path.join(rootDir, "workflow", "dist", src),
      path.join(workflowDistDir, dst)
    );
  }
}

function buildRecorderScripts(): void {
  const recorderSrc = path.join(rootDir, "recorder", "src");
  const files = ["recorder.py", "runner.py", "panel_state.py", "action_timeline.py", "evidence.py"];
  for (const file of files) {
    copyFile(path.join(recorderSrc, file), path.join(recorderDistDir, file));
  }
}

function buildPanel(): void {
  run("yarn", ["workspace", "panel", "build"]);
  copyFile(
    path.join(rootDir, "panel", "dist", "index.html"),
    path.join(panelDistDir, "index.html")
  );
}

function buildSkill(): void {
  fs.rmSync(skillDir, { recursive: true, force: true });
  fs.mkdirSync(skillScriptsDir, { recursive: true });

  run("yarn", ["workspace", "@odc/coverage-marker", "build"]);
  buildWorkflowScripts();
  buildPanel();
  buildRecorderScripts();
  renderSkillTemplate();
  copySubagentPrompts();
}

buildSkill();
