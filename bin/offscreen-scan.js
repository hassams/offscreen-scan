#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { failing, FORMATS, PKG } from "../src/report.js";
import { RULES } from "../src/rules.js";
import { scan } from "../src/scan.js";

const HELP = `Usage: offscreen-scan [options] [paths...]

Finds code hidden where reviewers can't see it: after long runs of spaces,
behind invisible Unicode characters, in absurdly long lines.

With no paths, scans the git repo's tracked and untracked (not ignored) files,
or every file under the current directory outside a git repo.

Options:
  --format <f>      text (default), json, github, sarif
  --output <file>   also write the report in --output-format to this file
  --output-format <f>  format for --output (default: sarif)
  --rules <list>    comma-separated rules to run (default: all)
  --disable <list>  comma-separated rules to skip
  --gap <n>         blank run length that counts as hiding (default 100)
  --max-line <n>    longest allowed line (default 2000)
  --fail-on <s>     error (default), warning, none
  -q, --quiet       report errors only
  --no-color        plain text output
  -h, --help        show this help
  -v, --version     show version

Rules: ${Object.keys(RULES).join(", ")}
Exit codes: 0 clean, 1 findings at or above --fail-on, 2 usage error.`;

const list = (s) => s?.split(",").map((x) => x.trim()).filter(Boolean);

function positiveInt(name, value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
        output: { type: "string" },
        "output-format": { type: "string", default: "sarif" },
        rules: { type: "string" },
        disable: { type: "string" },
        gap: { type: "string" },
        "max-line": { type: "string" },
        "fail-on": { type: "string", default: "error" },
        quiet: { type: "boolean", short: "q", default: false },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (e) {
    console.error(`offscreen-scan: ${e.message}\n\n${HELP}`);
    return 2;
  }
  const { values: o, positionals } = args;
  if (o.help) {
    console.log(HELP);
    return 0;
  }
  if (o.version) {
    console.log(PKG.version);
    return 0;
  }

  let result;
  try {
    for (const [flag, value, allowed] of [
      ["format", o.format, Object.keys(FORMATS)],
      ["output-format", o["output-format"], Object.keys(FORMATS)],
      ["fail-on", o["fail-on"], ["error", "warning", "none"]],
    ]) {
      if (!allowed.includes(value)) throw new Error(`--${flag} must be one of: ${allowed.join(", ")}`);
    }
    result = scan(process.cwd(), {
      paths: positionals,
      rules: list(o.rules),
      disable: list(o.disable),
      gap: positiveInt("gap", o.gap),
      maxLine: positiveInt("max-line", o["max-line"]),
    });
  } catch (e) {
    console.error(`offscreen-scan: ${e.message}`);
    return 2;
  }

  // Decide the exit code before --quiet hides anything.
  const failed = failing(result.findings, o["fail-on"]).length > 0;
  if (o.quiet) result.findings = result.findings.filter((f) => f.severity === "error");
  const useColor = o.format === "text" && !o["no-color"] && process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(FORMATS[o.format](result, { useColor }));
  if (o.output) writeFileSync(o.output, FORMATS[o["output-format"]](result) + "\n");
  return failed ? 1 : 0;
}

process.exitCode = main();
