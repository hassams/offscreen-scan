import assert from "node:assert/strict";
import { test } from "node:test";
import { escapePreview } from "../src/report.js";
import { resolveOptions, scanText } from "../src/scan.js";

// Payloads are built from escapes so this file stays clean under its own scan.
const PAYLOAD = "eval(atob('ZG9jdW1lbnQ='))";
const rules = (text, file = "a.js", opts = {}) => scanText(text, file, resolveOptions(opts)).map((f) => f.rule);

test("flags code after a long run of spaces", () => {
  const line = `module.exports = app;${" ".repeat(2000)}${PAYLOAD}`;
  const [f] = scanText(line, "index.js", resolveOptions()).filter((x) => x.rule === "whitespace-gap");
  assert.equal(f.severity, "error");
  assert.equal(f.column, "module.exports = app;".length + 2000 + 1);
  assert.equal(f.preview, PAYLOAD);
});

test("tabs and Unicode spaces count as blank", () => {
  assert.ok(rules(`a;${"\t".repeat(150)}b`).includes("whitespace-gap"));
  assert.ok(rules(`a;${"\u{a0}".repeat(150)}b`).includes("whitespace-gap"));
  assert.ok(rules(`a;${"\u{3164}".repeat(150)}b`).includes("whitespace-gap"));
});

test("short gaps and trailing whitespace are fine", () => {
  assert.deepEqual(rules(`a;${" ".repeat(99)}b`), []);
  assert.deepEqual(rules(`a;${" ".repeat(500)}`), []);
  assert.deepEqual(rules(`${" ".repeat(60)}indented();`), []);
});

test("--gap changes the threshold", () => {
  assert.ok(rules(`a;${" ".repeat(30)}b`, "a.js", { gap: 20 }).includes("whitespace-gap"));
});

test("previews never pass control or invisible characters through", () => {
  assert.equal(escapePreview("a\x1b[2Jb\u{200b}c"), "a\\u{1b}[2Jb\\u{200b}c");
  assert.equal(escapePreview("x".repeat(70), 5), "xxxxx...");
});

test("Markdown: padded table rows are fine, other gaps are warnings", () => {
  const sev = (text) => scanText(text, "README.md", resolveOptions()).map((f) => f.severity);
  assert.deepEqual(sev(`| a${" ".repeat(200)}| b |`), []);
  assert.deepEqual(sev(`Intro.${" ".repeat(200)}Hidden.`), ["warning"]);
});

test("a payload on its own line, indented far off-screen, is caught", () => {
  const [f] = scanText(`${" ".repeat(300)}${PAYLOAD}`, "a.js", resolveOptions()).filter((x) => x.rule === "whitespace-gap");
  assert.equal(f.column, 301);
  assert.match(f.message, /indented by 300 blank characters/);
  assert.deepEqual(rules(`${" ".repeat(99)}ok();`), []);
});

test("gradually deep nesting is fine, a sudden jump or absurd depth is not", () => {
  const stair = Array.from({ length: 30 }, (_, i) => `${" ".repeat(i * 4)}a ? b :`).join("\n");
  assert.deepEqual(rules(stair), []);
  assert.ok(rules(`ok();\n${" ".repeat(150)}${PAYLOAD}`).includes("whitespace-gap"));
  const steps = Array.from({ length: 10 }, (_, i) => `${" ".repeat(i * 90)}x();`).join("\n");
  assert.ok(rules(steps).includes("whitespace-gap"));
});

test("a staircase of lines can't walk the indentation baseline off-screen", () => {
  const filler = "\u{3164}";
  const invisibleStairs = `ok();\n${" ".repeat(90)}${filler}\n${" ".repeat(180)}${PAYLOAD}`;
  assert.ok(rules(invisibleStairs).includes("whitespace-gap"));
  const visibleStairs = `${" ".repeat(99)}x();\n${" ".repeat(198)}${PAYLOAD}`;
  assert.ok(rules(visibleStairs).includes("whitespace-gap"));
});
