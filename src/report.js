import { readFileSync } from "node:fs";

export const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Control, format, separator, private-use, variation selector and filler
// characters: anything that would act on the terminal or print as nothing.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{115F}\u{1160}\u{3164}\u{FFA0}]/u;

// Make a snippet safe to print: no control characters reach the terminal and
// invisible characters become visible escapes.
export function escapePreview(text, max = 60) {
  let out = "";
  let n = 0;
  for (const ch of text) {
    if (n >= max) {
      out += "...";
      break;
    }
    out += UNPRINTABLE.test(ch) ? `\\u{${ch.codePointAt(0).toString(16)}}` : ch;
    n++;
  }
  return out;
}

const SEVERITY_RANK = { warning: 1, error: 2 };

export function failing(findings, failOn) {
  if (failOn === "none") return [];
  return findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);
}

function color(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { red: wrap(31), yellow: wrap(33), dim: wrap(2), bold: wrap(1) };
}

export function formatText(result, { useColor = false } = {}) {
  const c = color(useColor);
  const lines = [];
  for (const f of result.findings) {
    const sev = f.severity === "error" ? c.red("error") : c.yellow("warning");
    lines.push(`${c.bold(`${escapePreview(f.file, Infinity)}:${f.line}:${f.column}`)} ${sev} ${f.message} ${c.dim(`[${f.rule}]`)}`);
    if (f.preview) lines.push(`    ${c.dim("hidden:")} ${escapePreview(f.preview)}`);
  }
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.length - errors;
  lines.push(
    result.findings.length
      ? `\n${errors} error(s), ${warnings} warning(s) in ${result.scanned} scanned file(s).`
      : `No hidden code found in ${result.scanned} scanned file(s).`,
  );
  return lines.join("\n");
}

export const FORMATS = { text: formatText };
