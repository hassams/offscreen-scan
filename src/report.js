import { readFileSync } from "node:fs";

export const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const DESCRIPTIONS = {
  "whitespace-gap": "Content hidden after a long run of blank characters, off the right edge of editors and diffs.",
  "invisible-char": "Zero-width, bidirectional, tag or filler characters that change or hide what a reviewer sees.",
  "long-line": "A line far longer than hand-written code, often where an appended payload lives.",
  "encoded-blob": "A long base64/hex-like string inside source code.",
  "decode-and-run": "A line that both decodes a string and executes code.",
  "too-large": "A file over the scan size limit, so it was not scanned.",
};

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

export function formatJson(result) {
  const findings = result.findings.map((f) => ({ ...f, preview: f.preview && escapePreview(f.preview, 200) }));
  return JSON.stringify({ ...result, findings }, null, 2);
}

// GitHub workflow commands: each finding becomes an annotation on the PR.
function escapeGithubData(s) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeGithubProperty(s) {
  return escapeGithubData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function formatGithub(result) {
  const lines = result.findings.map((f) => {
    const msg = f.preview ? `${f.message}: ${escapePreview(f.preview)}` : f.message;
    const level = f.severity === "error" ? "error" : "warning";
    return `::${level} file=${escapeGithubProperty(escapePreview(f.file, Infinity))},line=${f.line},col=${f.column},title=${escapeGithubProperty(`offscreen-scan ${f.rule}`)}::${escapeGithubData(msg)}`;
  });
  lines.push(formatText(result).split("\n").pop());
  return lines.join("\n");
}

// Encode each path segment so "#", "?" and ":" in a file name can't change
// which file the location points at. toWellFormed keeps a lone surrogate in a
// name from throwing.
function toUri(file) {
  return file.toWellFormed().split("/").map(encodeURIComponent).join("/");
}

export function formatSarif(result) {
  const rules = Object.entries(DESCRIPTIONS).map(([id, text]) => ({
    id,
    shortDescription: { text },
    helpUri: `${PKG.homepage}#${id}`,
  }));
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "offscreen-scan", version: PKG.version, informationUri: PKG.homepage, rules } },
          results: result.findings.map((f) => ({
            ruleId: f.rule,
            level: f.severity,
            message: { text: f.preview ? `${f.message}: ${escapePreview(f.preview)}` : f.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: toUri(f.file) },
                  region: { startLine: f.line, startColumn: f.column },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  );
}

export const FORMATS = { text: formatText, json: formatJson, github: formatGithub, sarif: formatSarif };
