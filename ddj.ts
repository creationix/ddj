#!/usr/bin/env bun
import { encode, decode, format } from "./dd-json";

let getTheme: ((name: string) => any) | undefined;
let colorize: ((theme: any, role: string, text: string) => string) | undefined;
let toAnsi256: ((hex: string) => number) | undefined;
try {
  const inkglow = await import("inkglow");
  getTheme = inkglow.getTheme;
  colorize = inkglow.colorize;
  toAnsi256 = inkglow.toAnsi256;
} catch {}

// --- arg parsing ---

const args = process.argv.slice(2);
const flags: Record<string, boolean> = {};
let file: string | undefined;
let outFile: string | undefined;
let themeName = "Inkglow";

const shortFlags: Record<string, string> = {
  s: "single", m: "multiline", c: "color", n: "noColor", J: "json", h: "help",
};
const shortWithArg: Record<string, true> = { t: true, o: true };

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--theme") { themeName = args[++i] || "Inkglow"; continue; }
  if (a === "--output") { outFile = args[++i]; continue; }
  if (a === "--single-line") { flags.single = true; continue; }
  if (a === "--multiline") { flags.multiline = true; continue; }
  if (a === "--color") { flags.color = true; continue; }
  if (a === "--no-color") { flags.noColor = true; continue; }
  if (a === "--json") { flags.json = true; continue; }
  if (a === "--help") { flags.help = true; continue; }
  if (a.startsWith("-") && !a.startsWith("--")) {
    // Combined short flags: -Js, -sc, -to out.ddj
    const chars = a.slice(1);
    for (let j = 0; j < chars.length; j++) {
      const ch = chars[j];
      if (shortWithArg[ch]) {
        const val = chars.slice(j + 1) || args[++i];
        if (ch === "t") themeName = val || "Inkglow";
        if (ch === "o") outFile = val;
        break;
      }
      const flag = shortFlags[ch];
      if (flag) { flags[flag] = true; continue; }
      process.stderr.write(`Unknown flag: -${ch}\n`); process.exit(1);
    }
    continue;
  }
  if (a.startsWith("-")) { process.stderr.write(`Unknown flag: ${a}\n`); process.exit(1); }
  file = a;
}

const usage = `ddj — deduplicated JSON

Usage:  ddj [file] [flags]

Input is auto-detected (JSON or DDJ). Reads from stdin if no file given.

Flags:
  -J, --json          Output as JSON (default: DDJ)
  -o, --output FILE   Write output to file
  -s, --single-line   Force compact single-line output
  -m, --multiline     Force multiline indented output
  -c, --color         Force color output
  -n, --no-color      Disable color
  -t, --theme NAME    Inkglow theme name (default: Inkglow)
  -h, --help          Show this help

Defaults: interactive terminal → multiline + color
          piped output        → single-line, no color

Examples:
  ddj data.json                  Encode JSON to DDJ (pretty + color)
  ddj data.json -s               Encode, single-line + color
  ddj data.json -o data.ddj       Encode to file (single-line, no color)
  ddj data.json > data.ddj       Same, using shell redirect
  ddj data.ddj -J                Decode DDJ back to JSON (pretty)
  ddj data.ddj -J -s             Decode to compact JSON
  ddj data.ddj -J > data.json    Decode to file (compact)
  cat data.json | ddj            Pipe JSON in, DDJ out
  cat data.ddj | ddj -J          Pipe DDJ in, JSON out
  ddj data.ddj -c | less -R     Color output in pager
  ddj data.ddj -m > pretty.ddj   Force multiline to file
  ddj data.json -n               No color on terminal
  ddj data.json -t "Inkglow Frost"   Use a different theme
`;

import { fstatSync } from "fs";
const stdinIsInteractive = !file && !fstatSync(0).isFIFO();
if (flags.help || stdinIsInteractive) { process.stderr.write(usage); process.exit(flags.help ? 0 : 1); }

// --- resolve defaults ---

const isInteractiveOut = outFile ? false : process.stdout.isTTY;
const useColor = flags.noColor ? false : (flags.color || isInteractiveOut) && !!getTheme;
const useSingleLine = flags.single ? true : flags.multiline ? false : !isInteractiveOut;

// --- read input ---

const input = file ? await Bun.file(file).text() : await readStdin();

// --- auto-detect input format ---

let data: unknown;
let inputIsJson = false;
try {
  data = JSON.parse(input);
  inputIsJson = true;
} catch {
  data = decode(input);
}

// --- output ---

function write(s: string): void {
  if (outFile) Bun.write(outFile, s);
  else process.stdout.write(s);
}

const raw = flags.json ? JSON.stringify(data) : encode(data);
if (!useColor && useSingleLine) {
  write(raw + "\n");
} else {
  const theme = useColor ? getTheme!(themeName) : undefined;
  const out = format(raw, { theme, colorize, indent: useSingleLine ? 0 : 2 });
  if (theme && toAnsi256) {
    const bg = `\x1b[48;5;${toAnsi256(theme.ui.background)}m`;
    // Replace every reset with reset+bg so background persists across tokens
    const colored = bg + out.replaceAll("\x1b[0m", "\x1b[0m" + bg);
    // Use erase-to-end-of-line (\x1b[K) so background fills the full terminal width
    const eol = "\x1b[K";
    write(bg + eol + "\n" + colored.replaceAll("\n", eol + "\n" + bg) + eol + "\n" + bg + eol + "\x1b[0m\n");
  } else {
    write(out + "\n");
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}
