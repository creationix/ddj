# dd-json

Deduplicated JSON — a JSON superset that compresses repetitive data by replacing repeated values with short `@` references.

```json
{"name":"Alice","friends":[{"name":"Bob"},{"name":"Alice"}]}
```

```ddj
{"name":"Alice","friends":[{@0:"Bob"},{@0:@1}]}
```

The encoder builds an implicit scope as it walks the data. Each unique value gets an auto-incrementing index on first encounter. When the same value appears again, it's replaced with `@` followed by that index in base-36. The decoder maintains the same table as it parses — no scope header, no byte offsets, no second pass.

## Why not just gzip/zstd the JSON?

You can — and you can gzip a `.ddj` file too (they stack). But dd-json solves a different problem:

- **Still text** — you can read it, grep it, diff it, pipe it, pretty-print it with syntax highlighting. Compressed JSON is an opaque blob.
- **No decompression step** — the decoder builds JavaScript objects directly as it parses. zstd+JSON requires decompress → full JSON string in memory → parse. dd-json skips the intermediate string.
- **Streamable** — single-pass, top-to-bottom. A decoder can start building objects before the full input arrives.
- **Inspectable** — `cat data.ddj | ddj format` gives you colored, indented output. Try that with `data.json.zst`.

If you just want smallest-possible cold storage, use zstd. dd-json is for when JSON is your **interface format** — APIs, configs, build manifests, caches — and you want it smaller without losing the properties that make JSON useful.

## Format

dd-json is a strict superset of JSON. Every valid JSON document is valid dd-json. The only extension is `@` references — strings, numbers, objects, and arrays use standard JSON syntax.

- **`@` references** — `@0`, `@1`, ..., `@a` (10), `@z` (35), `@10` (36) — base-36 scope index
- **Whitespace-tolerant** — the decoder skips whitespace and ANSI escape codes, so pretty-printed and syntax-highlighted output round-trips cleanly

### Implicit scope

Both encoder and decoder maintain a scope table — an ordered list of values, indexed from 0. The core rule is simple:

> **Inline value → gets a slot. `@` reference → no slot. `null`, `true`, `false` → no slot.**

That's the entire protocol. Here's what that means in practice:

**Gets a scope slot** (advances the index):
- Strings written inline
- Numbers written inline
- Objects `{...}` written inline
- Arrays `[...]` written inline

**Does NOT get a scope slot:**
- `@N` references (they look up an existing slot, they don't create one)
- `null`, `true`, `false` (always written as literals, never referenced)

**Ordering rule:** Children get their slots before their parent. A string inside an object gets a lower index than the object itself. This is natural depth-first order — values are added to the scope as they finish parsing.

**Why this matters:** The encoder and decoder must agree on exactly which values occupy which slots. If the encoder writes a value inline — even a repeat it chose not to deduplicate — that burns a slot. The decoder will see it, push it, and advance its index. If either side counts differently, every subsequent `@` reference points to the wrong value.

### Worked example

Input:

```json
{"name":"Alice","friends":[{"name":"Bob"},{"name":"Alice"}]}
```

Encoding trace:

```text
{                        → (start object, no slot yet)
  "name"                 → string, gets slot 0
  "Alice"                → string, gets slot 1
  "friends"              → string, gets slot 2
  [                      → (start array, no slot yet)
    {                    → (start object)
      @0                 → reference to slot 0 ("name") — no new slot
      "Bob"              → string, gets slot 3
    }                    → object done, gets slot 4
    {                    → (start object)
      @0                 → reference to slot 0 ("name") — no new slot
      @1                 → reference to slot 1 ("Alice") — no new slot
    }                    → object done, gets slot 5
  ]                      → array done, gets slot 6
}                        → root object done, gets slot 7
```

Output: `{"name":"Alice","friends":[{@0:"Bob"},{@0:@1}]}`

The decoder builds the same table as it parses, so `@0` always means `"name"` and `@1` always means `"Alice"`.

## Install

```sh
bun add dd-json
```

## Library

```typescript
import { encode, decode, format } from "dd-json";

// Encode: JavaScript value → dd-json string
const ddj = encode({ name: "Alice", friends: [{ name: "Bob" }, { name: "Alice" }] });
// '{"name":"Alice","friends":[{@0:"Bob"},{@0:@1}]}'

// Decode: dd-json string (or JSON) → JavaScript value
const obj = decode(ddj);
const obj2 = decode('{"name": "Alice"}'); // JSON works too

// Pretty-print with optional syntax highlighting
const pretty = format(ddj);

// With inkglow theme colors
import { getTheme, colorize } from "inkglow";
const colored = format(ddj, { theme: getTheme("Inkglow"), colorize });
```

### API

#### `encode(value: unknown): string`

Encodes a JavaScript value to compact dd-json. Single-pass, no intermediate data structures beyond hash tables for dedup lookups.

#### `decode(input: string): unknown`

Decodes dd-json (or plain JSON, or pretty-printed, or ANSI-colored) back to a JavaScript value. Skips whitespace and ANSI escape sequences automatically.

#### `format(input: string, options?): string`

Pretty-prints a dd-json or JSON string with indentation and optional syntax highlighting.

Options:
- `indent` — spaces per level (default: 2)
- `theme` — an inkglow theme object
- `colorize` — the `colorize` function from inkglow

## CLI

```sh
ddj [file] [flags]
```

Input is auto-detected — JSON is encoded to DDJ, DDJ is passed through. Reads from stdin if no file given.

```sh
ddj data.json                # JSON → DDJ (multiline + color on terminal)
ddj data.json -s             # JSON → DDJ (single-line + color on terminal)
ddj data.ddj -J              # DDJ → JSON
cat data.json | ddj          # pipe: JSON → DDJ (single-line, no color)
cat data.ddj | ddj -J        # pipe: DDJ → JSON
ddj data.ddj -c | less -R   # force color into pager
```

### Flags

| Short | Long | Description |
|-------|------|-------------|
| `-J` | `--json` | Output as JSON (default: DDJ) |
| `-s` | `--single-line` | Force compact single-line output |
| `-m` | `--multiline` | Force multiline indented output |
| `-c` | `--color` | Force color output |
| `-n` | `--no-color` | Disable color |
| `-t` | `--theme` | Inkglow theme name (default: Inkglow) |
| `-h` | `--help` | Show help |

Defaults: TTY → multiline + color, pipe → single-line + no color.

### Syntax highlighting

Colors use [inkglow](https://github.com/creationix/inkglow) themes when available. Install it for color support:

```sh
bun add inkglow
```

If inkglow is not installed, all output is plain text. The `colorize` option in the `format()` API lets you plug in any colorizer.

## Performance

Benchmarked on real-world JSON documents (Apple M4 Pro, Bun 1.3 / Node 22):

| Document             | Type           | JSON     | DDJ     | Reduction | Encode | Decode |
|----------------------|----------------|----------|---------|-----------|--------|--------|
| Docs site metadata   | Paths manifest | 121.5 MB | 14.9 MB | 87.8%     | 338ms  | 69ms   |
| Kubernetes pods (5K) | API response   | 2.1 MB   | 322 KB  | 85.2%     | 9ms    | 2ms    |
| Nobel laureates      | API response   | 3.6 MB   | 1.3 MB  | 63.9%     | 19ms   | 8ms    |
| IoT telemetry (50K)  | Sensor data    | 7.8 MB   | 2.8 MB  | 63.8%     | 44ms   | 24ms   |
| npm package metadata | Registry API   | 782 KB   | 288 KB  | 63.2%     | 3ms    | 3ms    |
| SF city lots         | GeoJSON        | 152 MB   | 63 MB   | 58.5%     | 1762ms | 348ms  |
| GitHub events (10K)  | API response   | 28.3 MB  | 12.6 MB | 55.3%     | 108ms  | 56ms   |
| Reddit thread        | API response   | 277 KB   | 129 KB  | 53.6%     | 1ms    | 1ms    |
| World countries      | GeoJSON        | 12.6 MB  | 10.4 MB | 18.0%     | 276ms  | 60ms   |

Reduction depends on data repetitiveness. Structured data with repeated shapes (manifests, K8s resources, config blobs) sees 80–88%. API responses and sensor data typically see 50–65%. Highly unique data (GeoJSON coordinates, JSON Schema descriptions) sees 16–18% — just key deduplication — but is never larger than the input.

## License

MIT
