// Line rules. Each rule looks at one line and returns findings for it.
// Every character class here is written with \u escapes so this file never
// contains (and flags) the characters it looks for.

// Spaces and tabs plus the Unicode spaces and blank-looking letters an editor
// also renders as nothing (Hangul fillers, the blank Braille pattern).
const BLANK_CHARS = " \\t\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000\\u3164\\uFFA0\\u2800";
const BLANK = `[${BLANK_CHARS}]`;
export const VISIBLE = `[^\\s${BLANK_CHARS}]`;

// Characters that render as nothing or reorder what you see. "hard" ones have
// no business in source text; "soft" ones turn up in real text (Persian and
// Indic joiners, emoji, character tables) and are judged by context.
const INVISIBLE = [
  [0x00ad, 0x00ad, "soft hyphen", "soft"],
  [0x034f, 0x034f, "combining grapheme joiner", "soft"],
  [0x180e, 0x180e, "Mongolian vowel separator", "soft"],
  [0x200b, 0x200d, "zero-width space/joiner", "soft"],
  [0x200e, 0x200f, "direction mark", "soft"],
  [0x202a, 0x202e, "bidirectional override", "hard"],
  [0x2060, 0x2064, "invisible operator", "soft"],
  [0x2066, 0x2069, "bidirectional isolate", "hard"],
  [0x115f, 0x1160, "Hangul filler", "hard"],
  [0x3164, 0x3164, "Hangul filler", "hard"],
  [0xffa0, 0xffa0, "Hangul filler", "hard"],
  [0xfeff, 0xfeff, "zero-width no-break space", "soft"],
  [0xfe00, 0xfe0f, "variation selector", "soft"],
  [0xe0000, 0xe007f, "Unicode tag character", "hard"],
  [0xe0100, 0xe01ef, "variation selector", "hard"],
];

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const BEFORE_ZWJ = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}]/u;
const KEYCAP_BASE = /[0-9#*]/;
const QUOTE = /["'`]/;
const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
const RUN_IS_HIDING = 3;

export const DEFAULTS = {
  gap: 100,
};

function classify(cp) {
  for (const [lo, hi, kind, strength] of INVISIBLE) if (cp >= lo && cp <= hi) return { kind, strength };
  return null;
}

const isTag = (cp) => cp >= 0xe0000 && cp <= 0xe007f;

// Is this invisible character doing an ordinary job where it stands?
function isOrdinary(chars, i, lineNumber, inFlag) {
  const cp = chars[i].codePointAt(0);
  const prev = chars[i - 1];
  const next = chars[i + 1];
  const prevCp = prev?.codePointAt(0);
  const nextCp = next?.codePointAt(0);
  if (cp === 0xfeff && lineNumber === 1 && i === 0) return true; // byte order mark
  if (isTag(cp)) return inFlag; // subdivision flags like England's
  if (cp === ZWJ && prev && next && BEFORE_ZWJ.test(prev) && PICTOGRAPH.test(next)) return true;
  if (cp === 0xfe0e || cp === 0xfe0f) {
    if (prev && !classify(prevCp) && (PICTOGRAPH.test(prev) || KEYCAP_BASE.test(prev) || prevCp > 0x7f)) return true;
  }
  if (classify(cp).strength === "hard") return false;
  // Joiners and marks between two visible non-ASCII characters: real script
  // text (Persian, Hindi, ...) or a character table.
  if (prev && next && prevCp > 0x7f && nextCp > 0x7f && !classify(prevCp) && !classify(nextCp)) return true;
  // The whole content of a string literal, e.g. "\u{200c}" written out raw.
  if (prev && QUOTE.test(prev) && next === prev) return true;
  return false;
}

export function invisibleChars(line, ctx) {
  const findings = [];
  const chars = Array.from(line);
  let column = 1;
  let run = null;
  let inFlag = false;
  const flush = () => {
    if (!run) return;
    const hiding = run.hard || run.count >= RUN_IS_HIDING || !ctx.dependency;
    const count = run.count === 1 ? "an invisible character" : `${run.count} invisible characters`;
    findings.push({
      rule: "invisible-char",
      severity: hiding ? "error" : "warning",
      column: run.column,
      message: `${count} (${[...run.kinds].join(", ")})`,
    });
    run = null;
  };
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (cp === BLACK_FLAG) inFlag = true;
    else if (!isTag(cp)) inFlag = false;
    const c = classify(cp);
    if (!c || isOrdinary(chars, i, ctx.lineNumber, inFlag)) {
      flush();
    } else {
      run ??= { column, count: 0, kinds: new Set(), hard: false };
      run.count++;
      run.kinds.add(c.kind);
      run.hard ||= c.strength === "hard";
    }
    column += chars[i].length;
  }
  flush();
  return findings;
}

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
  "invisible-char": invisibleChars,
};

export function checkLine(line, ctx) {
  const out = [];
  for (const name of ctx.rules) out.push(...RULES[name](line, ctx));
  return out;
}
