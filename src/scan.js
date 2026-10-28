import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { checkLine, DEFAULTS, RULES, VISIBLE } from "./rules.js";

const FIRST_VISIBLE = new RegExp(VISIBLE, "u");

const MAX_BYTES = 5 * 1024 * 1024;

const CODE = new Set(
  [
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte",
    ".py", ".rb", ".php", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".cs",
    ".c", ".h", ".cc", ".cpp", ".hpp", ".swift", ".m", ".dart", ".lua", ".pl",
    ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".bat", ".cmd",
  ],
);

const PROSE = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"]);

// Files that are long-lined or blob-heavy by nature. Only the hiding rules
// (whitespace-gap, invisible-char) run on them.
const GENERATED = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/,
  /\.min\.[a-z]+$/,
  /\.(map|snap|svg)$/,
  /(^|\/)(dist|build|vendor)\//,
];

const ALWAYS_SKIP_DIRS = new Set([".git", ".hg", ".svn"]);
const DEPENDENCY_DIRS = new Set(["node_modules"]);

function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

function walk(dir, root, { deps }, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (ALWAYS_SKIP_DIRS.has(e.name)) continue;
      if (DEPENDENCY_DIRS.has(e.name) && !deps) continue;
      walk(full, root, { deps }, out);
    } else if (e.isFile()) {
      out.push(toPosix(relative(root, full)));
    }
  }
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function isGitRepo(root) {
  try {
    return git(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

// Which files to look at: explicit paths are walked; otherwise a git repo's
// tracked and untracked-but-not-ignored files; otherwise everything under root.
export function listFiles(root, options) {
  let files = [];
if (options.paths.length) {
    for (const p of options.paths) {
      const full = join(root, p);
      let st;
      try {
        st = statSync(full);
      } catch {
        throw new Error(`no such file or directory: ${p}`);
      }
      if (st.isDirectory()) walk(full, root, options, files);
      else files.push(toPosix(relative(root, full)));
    }
  } else if (isGitRepo(root)) {
    files = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
      .split("\0")
      .filter(Boolean);
  } else {
    walk(root, root, options, files);
  }
  return [...new Set(files)].sort();
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function scanText(text, file, options) {
  const ctx = {
    file,
    options,
    rules: options.rules,
    code: CODE.has(extname(file).toLowerCase()),
    prose: PROSE.has(extname(file).toLowerCase()),
    dependency: /(^|\/)node_modules\//.test(file),
    generated: GENERATED.some((re) => re.test(file)),
    lineNumber: 0,
    prevIndent: 0,
  };
  const findings = [];
  const lines = text.split(/\r?\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    ctx.lineNumber = i + 1;
    for (const f of checkLine(lines[i], ctx)) findings.push({ file, line: i + 1, ...f });
    const indent = lines[i].search(FIRST_VISIBLE);
    if (indent !== -1 && indent < options.gap) ctx.prevIndent = indent;
  }
  return findings;
}

export function scanFile(root, file, options) {
  let st;
  try {
    st = lstatSync(join(root, file));
  } catch {
    return { scanned: false, findings: [] };
  }
  // Symlinks are skipped, like in the directory walk: a tracked link can point
  // anywhere on the machine, and its target isn't part of the repository.
  if (!st.isFile()) return { scanned: false, findings: [] };
  if (st.size > MAX_BYTES) {
    // Padding a file past a size limit is itself a way to hide, so say so.
    return {
      scanned: false,
      findings: [
        {
          file,
          line: 1,
          column: 1,
          rule: "too-large",
          severity: "warning",
          message: `file is ${(st.size / 1024 / 1024).toFixed(1)} MB, over the 5 MB scan limit; not scanned`,
        },
      ],
    };
  }
  const buf = readFileSync(join(root, file));
  if (looksBinary(buf)) return { scanned: false, findings: [] };
  return { scanned: true, findings: scanText(buf.toString("utf8"), file, options) };
}

export function resolveOptions(raw = {}) {
  const input = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  const options = {
    paths: [],
    ignore: [],
    deps: false,
    changed: null,
    ...DEFAULTS,
    ...input,
  };
  const all = Object.keys(RULES);
  let rules = input.rules ?? all;
  for (const r of rules) if (!RULES[r]) throw new Error(`unknown rule: ${r} (known: ${all.join(", ")})`);
  if (input.disable) rules = rules.filter((r) => !input.disable.includes(r));
  options.rules = rules;
  return options;
}

export function scan(root, input) {
  const options = resolveOptions(input);
  const files = listFiles(root, options);
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    const r = scanFile(root, file, options);
    if (r.scanned) scanned++;
    findings.push(...r.findings);
  }
  return { files: files.length, scanned, findings };
}
