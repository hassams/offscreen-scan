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

test("bad arguments exit 2", () => {
  const dir = repo({ "a.js": "ok;\n" });
  assert.equal(run(dir, "--format", "xml").status, 2);
  assert.equal(run(dir, "--gap", "0").status, 2);
  assert.equal(run(dir, "missing-dir").status, 2);
  assert.equal(run(dir, "--bogus").status, 2);
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
