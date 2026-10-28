import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/offscreen-scan.js", import.meta.url));
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function repo(files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "offscreen-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  if (git) {
    const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  }
  return dir;
}

const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
const hidden = `export default 1;${" ".repeat(1500)}globalThis.x = 1;\n`;

test("clean repo exits 0", () => {
  const r = run(repo({ "a.js": "export default 1;\n" }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No hidden code found in 1 scanned file/);
});

test("hidden code exits 1 and says where", () => {
  const r = run(repo({ "src/a.js": hidden }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /src\/a\.js:1:1518 error content after 1500 blank characters/);
  assert.match(r.stdout, /hidden: globalThis\.x = 1;/);
});

test("github format emits annotations", () => {
  const r = run(repo({ "a.js": hidden }), "--format", "github");
  assert.match(r.stdout, /^::error file=a\.js,line=1,col=1518,title=offscreen-scan whitespace-gap::/m);
});

test("sarif output is written alongside", () => {
  const dir = repo({ "a.js": hidden });
  const r = run(dir, "--output", "out.sarif");
  assert.equal(r.status, 1);
  const sarif = JSON.parse(readFileSync(join(dir, "out.sarif"), "utf8"));
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results[0].ruleId, "whitespace-gap");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startColumn, 1518);
});

test("--fail-on and --ignore", () => {
  const dir = repo({ "a.js": hidden, "fixtures/b.js": hidden });
  assert.equal(run(dir, "--fail-on", "none").status, 0);
  const r = run(dir, "--ignore", "a.js", "--ignore", "fixtures/**");
  assert.equal(r.status, 0, r.stdout);
});

test("warnings fail only with --fail-on warning", () => {
  const dir = repo({ "a.js": "eval(atob(s));\n" });
  assert.equal(run(dir).status, 0);
  assert.equal(run(dir, "--fail-on", "warning").status, 1);
});

test("git mode skips ignored files; --deps adds node_modules", () => {
  const dir = repo({ ".gitignore": "node_modules/\n", "a.js": "ok;\n", "node_modules/evil/index.js": hidden });
  assert.equal(run(dir).status, 0);
  const r = run(dir, "--deps");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /node_modules\/evil\/index\.js/);
});

test("works outside git and skips binary files", () => {
  const dir = repo({ "a.js": "ok;\n", "img.bin": Buffer.from([0, 1, 2, 0x20, 0x20]) }, { git: false });
  const r = run(dir, "--format", "json");
  assert.equal(r.status, 0);
  const json = JSON.parse(r.stdout);
  assert.equal(json.files, 2);
  assert.equal(json.scanned, 1);
});

test("--changed scans only files changed since a ref", () => {
  const dir = repo({ "old.js": hidden });
  execFileSync("git", ["checkout", "-qb", "feature"], { cwd: dir });
  writeFileSync(join(dir, "new.js"), "ok;\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: dir });
  const r = run(dir, "--changed", "main");
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /1 scanned file/);
});

test("bad arguments exit 2", () => {
  const dir = repo({ "a.js": "ok;\n" });
  assert.equal(run(dir, "--format", "xml").status, 2);
  assert.equal(run(dir, "--gap", "0").status, 2);
  assert.equal(run(dir, "missing-dir").status, 2);
  assert.equal(run(dir, "--bogus").status, 2);
});

test("--quiet drops warnings", () => {
  const dir = repo({ "a.js": "eval(atob(s));\n" });
  const r = run(dir, "--quiet", "--format", "json");
  assert.deepEqual(JSON.parse(r.stdout).findings, []);
});

test("tracked symlinks are not followed", { skip: process.platform === "win32" }, async () => {
  const { symlinkSync } = await import("node:fs");
  const outside = repo({ "secret.js": hidden }, { git: false });
  const dir = repo({ "a.js": "ok;\n" });
  symlinkSync(join(outside, "secret.js"), join(dir, "link.js"));
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout);
});

test("file names are escaped in text and annotations", { skip: process.platform === "win32" }, () => {
  const dir = repo({ "a\x1b[2J.js": hidden }, { git: false });
  const text = run(dir, "--no-color").stdout;
  assert.ok(!text.includes("\x1b"));
  assert.match(text, /a\\u\{1b\}\[2J\.js:1:/);
  assert.ok(!run(dir, "--format", "github").stdout.includes("\x1b"));
});

test("SARIF locations encode delimiters in file names", { skip: process.platform === "win32" }, () => {
  const dir = repo({ "a#b?.js": hidden }, { git: false });
  run(dir, "--output", "out.sarif");
  const sarif = JSON.parse(readFileSync(join(dir, "out.sarif"), "utf8"));
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "a%23b%3F.js");
});
