#!/usr/bin/env bun
import { encode, decode, format } from "./dd-json";

let getTheme: ((name: string) => any) | undefined;
let colorize: ((theme: any, role: string, text: string) => string) | undefined;
try {
  const inkglow = await import("inkglow");
  getTheme = inkglow.getTheme;
  colorize = inkglow.colorize;
} catch {}

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("-")));
const positional = args.filter(a => !a.startsWith("-"));

const cmd = positional[0];
const file = positional[1];

const usage = `ddj — deduplicated JSON

Usage:
  ddj encode [file]       Encode JSON → dd-json (compact)
  ddj decode [file]       Decode dd-json → JSON
  ddj format [file]       Pretty-print with syntax highlighting

Flags:
  -c, --compact           Compact output (no formatting)
  -C, --color             Force color output (for piping to less -R)
  -n, --no-color          Disable syntax highlighting
  -t, --theme <name>      Inkglow theme (default: Inkglow)

Reads from stdin if no file is given.
Accepts .json, .ddj, or piped input for all commands.
`;

if (!cmd || flags.has("-h") || flags.has("--help")) {
  process.stderr.write(usage);
  process.exit(cmd ? 0 : 1);
}

const input = file ? await Bun.file(file).text() : await readStdin();
const forceColor = flags.has("--color") || flags.has("-C");
const useColor = (forceColor || (process.stdout.isTTY && !flags.has("-n") && !flags.has("--no-color"))) && !!getTheme;
const compact = flags.has("-c") || flags.has("--compact");

const themeName = (() => {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-t" || args[i] === "--theme") && args[i + 1]) return args[i + 1];
  }
  return "Inkglow";
})();

switch (cmd) {
  case "encode":
  case "e": {
    const data = JSON.parse(input);
    const encoded = encode(data);
    if (compact || !process.stdout.isTTY && !forceColor) {
      process.stdout.write(encoded + "\n");
    } else {
      const theme = useColor ? getTheme(themeName) : undefined;
      process.stdout.write(format(encoded, { theme, colorize }));
    }
    break;
  }

  case "decode":
  case "d": {
    const data = decode(input);
    if (compact) {
      process.stdout.write(JSON.stringify(data) + "\n");
    } else {
      process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    }
    break;
  }

  case "format":
  case "f": {
    const theme = useColor ? getTheme(themeName) : undefined;
    process.stdout.write(format(input, { theme, colorize }));
    break;
  }

  default:
    // No command — auto-detect: if input looks like JSON, encode it; otherwise format it
    if (input.trimStart().startsWith("{") || input.trimStart().startsWith("[")) {
      try {
        // Try as JSON first
        const data = JSON.parse(input);
        const encoded = encode(data);
        if (compact || !process.stdout.isTTY && !forceColor) {
          process.stdout.write(encoded + "\n");
        } else {
          const theme = useColor ? getTheme(themeName) : undefined;
          process.stdout.write(format(encoded, { theme, colorize }));
        }
      } catch {
        // Not valid JSON — treat as dd-json, format it
        const theme = useColor ? getTheme(themeName) : undefined;
        process.stdout.write(format(input, { theme, colorize }));
      }
    } else {
      // Has @ references or bare strings — dd-json, format it
      const theme = useColor ? getTheme(themeName) : undefined;
      process.stdout.write(format(input, { theme, colorize }));
    }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}
