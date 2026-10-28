#!/usr/bin/env node
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
  --gap <n>         blank run length that counts as hiding (default 100)
  --fail-on <s>     error (default), warning, none
  --no-color        plain text output
  -h, --help        show this help
  -v, --version     show version

Rules: ${Object.keys(RULES).join(", ")}
Exit codes: 0 clean, 1 findings at or above --fail-on, 2 usage error.`;

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
        gap: { type: "string" },
        "fail-on": { type: "string", default: "error" },
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
      ["fail-on", o["fail-on"], ["error", "warning", "none"]],
    ]) {
      if (!allowed.includes(value)) throw new Error(`--${flag} must be one of: ${allowed.join(", ")}`);
    }
    result = scan(process.cwd(), {
      paths: positionals,
      gap: positiveInt("gap", o.gap),
    });
  } catch (e) {
    console.error(`offscreen-scan: ${e.message}`);
    return 2;
  }

  const failed = failing(result.findings, o["fail-on"]).length > 0;
  const useColor = !o["no-color"] && process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(FORMATS.text(result, { useColor }));
  return failed ? 1 : 0;
}

process.exitCode = main();
