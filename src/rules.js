// Line rules. Each rule looks at one line and returns findings for it.
// Every character class here is written with \u escapes so this file never
// contains (and flags) the characters it looks for.

// Spaces and tabs plus the Unicode spaces and blank-looking letters an editor
// also renders as nothing (Hangul fillers, the blank Braille pattern).
const BLANK_CHARS = " \\t\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000\\u3164\\uFFA0\\u2800";
const BLANK = `[${BLANK_CHARS}]`;
export const VISIBLE = `[^\\s${BLANK_CHARS}]`;

export const DEFAULTS = {
  gap: 100,
};

// A padded Markdown table row is the one ordinary place for a huge gap.
const TABLE_ROW = /^\s*\|/;

// Something visible (or the start of the line), a long blank run, then more
// content. Catches both a payload appended after a normal line and one on a
// line of its own, indented far enough to look empty. Indentation counts when
// it jumps half a gap past the last on-screen line's, or is beyond any real
// nesting.
export function whitespaceGap(line, ctx) {
  if (ctx.prose && TABLE_ROW.test(line)) return [];
  const re = new RegExp(`(^|${VISIBLE})(${BLANK}{${ctx.options.gap},})(?=${VISIBLE})`, "gu");
  const findings = [];
  for (const m of line.matchAll(re)) {
    const hiddenAt = m.index + m[0].length;
    const leading = m[1] === "";
    // Deeply nested code indents a few columns per line; hiding jumps. The
    // baseline only ever comes from on-screen lines (see scanText), so a
    // staircase of lines can't walk it off-screen.
    if (leading && hiddenAt - ctx.prevIndent < ctx.options.gap / 2 && hiddenAt < ctx.options.gap * 3) continue;
    const where = leading ? "indented by" : "after";
    findings.push({
      rule: "whitespace-gap",
      severity: ctx.prose ? "warning" : "error",
      column: hiddenAt + 1,
      message: `content ${where} ${m[2].length} blank characters, pushed off-screen`,
      preview: line.slice(hiddenAt),
    });
  }
  return findings;
}

export const RULES = {
  "whitespace-gap": whitespaceGap,
};

export function checkLine(line, ctx) {
  const out = [];
  for (const name of ctx.rules) out.push(...RULES[name](line, ctx));
  return out;
}
