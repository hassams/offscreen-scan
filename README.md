# offscreen-scan

[![ci](https://github.com/hassams/offscreen-scan/actions/workflows/ci.yml/badge.svg)](https://github.com/hassams/offscreen-scan/actions/workflows/ci.yml)

Find code hidden where reviewers can't see it.

```
lib/helpers.js:41:2028 error content after 2000 blank characters, pushed off-screen [whitespace-gap]
    hidden: ;(function(a,b){var c=a.split('').reverse().join('');eval(...
```

A real attack this tool was built after: an obfuscated payload appended to the
last line of an ordinary source file, behind about 2,000 spaces. Editors don't
wrap it, GitHub's diff view doesn't wrap it, and a reviewer scrolling a PR sees
a normal-looking line. It was in the repository's history for over a year
before anyone noticed, and it ran in production.

`offscreen-scan` is a zero-dependency CLI and GitHub Action that fails the build
when a file contains:

- content pushed off-screen by a long run of spaces, tabs or Unicode blanks
- invisible characters: zero-width, bidirectional overrides ("Trojan Source"),
  Hangul fillers, variation-selector payloads ("GlassWorm"-style), and Unicode
  tag characters that smuggle hidden instructions into `AGENTS.md` / `CLAUDE.md`
  style files read by AI agents
- lines far longer than anyone writes by hand
- long encoded blobs, and lines that decode a string and execute it

It is deterministic: no network, no AI, the same input always gives the same
answer.

## Quick start

```sh
npx github:hassams/offscreen-scan            # scan the current git repo
npx github:hassams/offscreen-scan --deps     # ...and node_modules
```

Exit code `0` means clean, `1` means findings, `2` means a usage error.
Requires Node 20 or newer.

### GitHub Action

```yaml
name: hidden-code
on: [push, pull_request]

permissions:
  contents: read
  security-events: write # only for the SARIF upload

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - id: scan
        uses: hassams/offscreen-scan@v0
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: ${{ steps.scan.outputs.sarif-file }}
```

Findings show up as annotations on the PR, and in the Security tab if you
upload the SARIF report. The upload step is optional.

| Input | Default | |
|---|---|---|
| `paths` | whole repo | Space-separated paths to scan |
| `changed-only` | `false` | On PRs, scan only changed files (checkout with `fetch-depth: 0`) |
| `deps` | `false` | Also scan `node_modules`; put it after your install step |
| `fail-on` | `error` | `error`, `warning` or `none` |
| `ignore` | | Newline-separated globs to skip |
| `args` | | Extra CLI flags, e.g. `--gap 60 --quiet` |
| `sarif-file` | `offscreen-scan.sarif` | Where the SARIF report is written |

## What it checks

Errors fail the run by default. Warnings are reported but only fail with
`--fail-on warning`.

### whitespace-gap

**Error.** Something visible, then 100 or more blank characters (`--gap`),
then more content on the same line. Also a line of its own indented far enough
to look empty: indented 100+ columns and at least 50 past the last on-screen
line's indentation, or beyond column 300. Counts spaces, tabs, no-break spaces,
the other Unicode spaces, the Hangul fillers and the blank Braille pattern.
Trailing whitespace and ordinary (even deep) indentation are fine. In Markdown and other prose files a padded table row
(`| ... |`) is ignored and any other gap is a warning.

### invisible-char

**Error.** Characters that render as nothing or reorder text:

| Always flagged | Flagged unless ordinary in context |
|---|---|
| bidirectional overrides and isolates | zero-width space, joiner, non-joiner |
| Unicode tag characters | left-to-right / right-to-left marks |
| Hangul fillers | invisible operators |
| supplementary variation selectors | a byte order mark after the start of the file |
| | basic variation selectors |
| | soft hyphen, combining grapheme joiner, Mongolian vowel separator |

"Ordinary in context" means: part of a real emoji (joined sequences, skin
tones, keycaps, subdivision flags such as England's), a joiner or mark between
two non-ASCII characters (Persian, Hindi and similar scripts need them), or a
string literal that contains only that one character. Three or more in a row
are always an error. Inside `node_modules` a lone stray one is a warning, since
published packages are full of harmless typos.

### long-line

**Warning.** A line longer than 2000 characters (`--max-line`). Skipped for
lockfiles, `*.min.*`, source maps, snapshots, SVGs and `dist/`, `build/`,
`vendor/`. Off by default with `--deps`, since bundled packages are all long
lines.

### encoded-blob

**Warning.** A base64/hex-like run of 1000 or more characters in a source code
file, other than a `data:` URI.

### decode-and-run

**Warning.** One line that both decodes (`atob`, `Buffer.from(..., 'base64')`,
`fromCharCode`, `b64decode`, ...) and executes (`eval`, `Function`, `exec`,
`spawn`, ...).

### too-large

**Warning.** A file over 5 MB is not scanned, and says so instead of being
silently skipped, because padding a file past a size limit is another way to
hide.

The hiding rules (`whitespace-gap`, `invisible-char`) run on every text file,
including lockfiles and generated code: there is no file type where those are
expected. Binary files (anything with a NUL byte in the first 8 KB) are
skipped.

## CLI

```
offscreen-scan [options] [paths...]

  --format <f>         text (default), json, github, sarif
  --output <file>      also write a report to this file
  --output-format <f>  format for --output (default: sarif)
  --changed <ref>      only scan files changed between <ref> and HEAD
  --deps               also scan node_modules
  --ignore <glob>      skip matching paths (repeatable)
  --rules <list>       comma-separated rules to run
  --disable <list>     comma-separated rules to skip
  --gap <n>            blank run length that counts as hiding (default 100)
  --max-line <n>       longest allowed line (default 2000)
  --fail-on <s>        error (default), warning, none
  -q, --quiet          report errors only
  --no-color           plain text output
```

With no paths it scans the git repository's tracked files plus untracked files
that aren't ignored; outside a git repository, everything under the current
directory.

Previews of hidden content and file names are escaped before printing, so a
payload can't send control sequences to your terminal or CI log. Symlinks are
never followed.

### Scanning dependencies

```sh
npm ci --ignore-scripts
npx github:hassams/offscreen-scan --deps --quiet
```

Tested against the 27,000 files that `next`, `react`, `typescript`, `webpack`,
`eslint`, `jest`, `zod`, `date-fns` and friends install: the only errors are in
Next.js's compiled React development runtime, which builds function names out
of runs of zero-width spaces on purpose. It does look exactly like hiding. Skip
it with:

```sh
--ignore "node_modules/next/dist/compiled/**"
```

## No inline suppressions, on purpose

There is no `// offscreen-scan-disable` comment. A suppression comment is one
more thing an attacker can hide off-screen next to their payload. Exceptions
go in `--ignore` globs, which live in your workflow file where a reviewer sees
them change.

If your own code needs an invisible character, write it as an escape
(`"\u200b"`). The scanner never flags escapes, and the next reader can see it.

## Limits

This finds hiding, not malware. Obfuscated code on a normal-length,
normally-indented line, a malicious dependency that doesn't hide anything, or a
payload fetched at runtime all pass. Use it alongside lockfile review, `npm
audit` and pinned dependencies, not instead of them.

## JavaScript API

```js
import { scan, scanText, resolveOptions } from "offscreen-scan";

const { findings } = scan(process.cwd(), { deps: true });
const inline = scanText(source, "file.js", resolveOptions());
```

## License

MIT
