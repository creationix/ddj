
export function encode(rootValue: unknown): string {
  const maxDedup = 16;
  let out = "";
  let nextIdx = 0;
  // Stores [scopeIndex, inlineEncoding] — caches JSON.stringify on first encounter
  const primCache = new Map<string | number, [number, string]>();
  const objHash = new Map<object, number>();
  const hashTable = new Map<number, { idx: number, val: object, json?: string }>();
  let nextUniqueHash = 0x80000000;
  const refCache: string[] = [];

  writeVal(rootValue);
  return out;

  function refLen(idx: number): number {
    if (idx === 0) return 1;
    let n = idx, len = 1;
    while (n > 0) { len++; n = Math.floor(n / 36); }
    return len;
  }

  function putref(idx: number): void {
    let r = refCache[idx];
    if (r === undefined) {
      r = "@" + idx.toString(36);
      refCache[idx] = r;
    }
    out += r;
  }

  function hashStr(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h;
  }
  function mix(h: number, v: number): number {
    h = h + v | 0;
    h = Math.imul(h, 0x9e3779b9);
    return (h >>> 16) ^ h;
  }
  function computeHash(val: unknown): number {
    if (typeof val === "string") return hashStr(val);
    if (typeof val === "number") return Math.imul(val * 2654435761 | 0, 0x01000193);
    if (!val || typeof val !== "object") return 0;
    const cached = objHash.get(val);
    if (cached !== undefined) return cached;
    let h: number;
    if (Array.isArray(val)) {
      if (val.length > maxDedup) { h = nextUniqueHash++; objHash.set(val, h); return h; }
      h = 0x65787039;
      for (let i = 0; i < val.length; i++) h = mix(h, computeHash(val[i]));
    } else {
      const keys = Object.keys(val);
      if (keys.length > maxDedup) { h = nextUniqueHash++; objHash.set(val, h); return h; }
      h = 0x6f626a31;
      const obj = val as Record<string, unknown>;
      for (let i = 0; i < keys.length; i++) {
        h = mix(h, hashStr(keys[i]));
        h = mix(h, computeHash(obj[keys[i]]));
      }
    }
    objHash.set(val, h);
    return h;
  }

  function writeVal(val: unknown): void {
    // Primitives: null, true, false — always inline, no scope slot
    if (val === null) { out += "null"; return; }
    if (val === true) { out += "true"; return; }
    if (val === false) { out += "false"; return; }

    // Strings and numbers: dedup by value, cache inline encoding
    if (typeof val === "string" || typeof val === "number") {
      const cached = primCache.get(val);
      if (cached !== undefined) {
        if (refLen(cached[0]) < cached[1].length) { putref(cached[0]); return; }
        // Ref not worth it — write inline, assign new slot
        cached[0] = nextIdx++;
        out += cached[1];
        return;
      }
      const inline = JSON.stringify(val);
      primCache.set(val, [nextIdx++, inline]);
      out += inline;
      return;
    }

    // Arrays and objects
    if (typeof val !== "object" || val === null) return;

    const isArr = Array.isArray(val);
    const keys = isArr ? null : Object.keys(val);
    const len = isArr ? val.length : keys!.length;

    // Structural dedup for small containers
    if (len <= maxDedup) {
      const h = computeHash(val);
      const entry = hashTable.get(h);
      if (entry !== undefined) {
        const ej = entry.json ??= JSON.stringify(entry.val);
        if (ej === JSON.stringify(val)) { putref(entry.idx); return; }
      }
      if (isArr) {
        out += "[";
        for (let i = 0; i < len; i++) { if (i > 0) out += ","; writeVal(val[i]); }
        out += "]";
      } else {
        const obj = val as Record<string, unknown>;
        out += "{";
        for (let i = 0; i < len; i++) { if (i > 0) out += ","; writeVal(keys![i]); out += ":"; writeVal(obj[keys![i]]); }
        out += "}";
      }
      const myIdx = nextIdx++;
      if (!hashTable.has(h)) hashTable.set(h, { idx: myIdx, val: val as object });
    } else {
      if (isArr) {
        out += "[";
        for (let i = 0; i < len; i++) { if (i > 0) out += ","; writeVal(val[i]); }
        out += "]";
      } else {
        const obj = val as Record<string, unknown>;
        out += "{";
        for (let i = 0; i < len; i++) { if (i > 0) out += ","; writeVal(keys![i]); out += ":"; writeVal(obj[keys![i]]); }
        out += "}";
      }
      nextIdx++;
    }
  }
}

export function format(input: string, { theme, indent = 2, colorize }: { theme?: any, indent?: number, colorize?: (theme: any, role: string, text: string) => string } = {}): string {
  const c = theme && colorize
    ? (role: string, text: string) => colorize(theme, role, text)
    : (_: string, text: string) => text;

  let out = "";
  let pos = 0;
  let depth = 0;
  const tab = " ".repeat(indent);

  function skip(): void {
    while (pos < input.length && input.charCodeAt(pos) <= 0x20) pos++;
  }
  const compact = indent === 0;
  function nl(): void { if (!compact) out += "\n" + tab.repeat(depth); }

  function token(isKey: boolean): string {
    skip();
    const ch = input.charCodeAt(pos);

    // @ reference
    if (ch === 0x40) {
      const start = pos++;
      while (pos < input.length) {
        const cc = input.charCodeAt(pos);
        if ((cc >= 0x30 && cc <= 0x39) || (cc >= 0x61 && cc <= 0x7A)) pos++;
        else break;
      }
      return c("keyword.control", input.substring(start, pos));
    }

    // quoted string
    if (ch === 0x22) {
      const start = pos++;
      while (input.charCodeAt(pos) !== 0x22) {
        if (input.charCodeAt(pos) === 0x5C) pos++;
        pos++;
      }
      pos++;
      const raw = input.substring(start, pos);
      return c(isKey ? "property" : "string", raw);
    }

    // number
    if (ch === 0x2D || (ch >= 0x30 && ch <= 0x39)) {
      const start = pos++;
      while (pos < input.length) {
        const cc = input.charCodeAt(pos);
        if ((cc >= 0x30 && cc <= 0x39) || cc === 0x2E || cc === 0x65 || cc === 0x45 || cc === 0x2B || cc === 0x2D) pos++;
        else break;
      }
      return c("number", input.substring(start, pos));
    }

    // keyword (true/false/null)
    const start = pos;
    while (pos < input.length && input.charCodeAt(pos) >= 0x61 && input.charCodeAt(pos) <= 0x7A) pos++;
    const text = input.substring(start, pos);
    if (text === "true" || text === "false") return c("boolean", text);
    return c("constant", text); // null
  }

  function writeVal(isKey: boolean): void {
    skip();
    const ch = input.charCodeAt(pos);

    if (ch === 0x5B) {
      pos++;
      out += c("bracket", "[");
      skip();
      if (input.charCodeAt(pos) !== 0x5D) {
        depth++;
        nl();
        writeVal(false);
        skip();
        while (input.charCodeAt(pos) === 0x2C) {
          pos++;
          out += c("punctuation", ",");
          nl();
          writeVal(false);
          skip();
        }
        depth--;
        nl();
      }
      pos++;
      out += c("bracket", "]");
      return;
    }

    if (ch === 0x7B) {
      pos++;
      out += c("bracket", "{");
      skip();
      if (input.charCodeAt(pos) !== 0x7D) {
        depth++;
        nl();
        out += token(true);
        skip(); pos++; skip();
        out += c("punctuation", compact ? ":" : ": ");
        writeVal(false);
        skip();
        while (input.charCodeAt(pos) === 0x2C) {
          pos++;
          out += c("punctuation", ",");
          nl();
          out += token(true);
          skip(); pos++; skip();
          out += c("punctuation", compact ? ":" : ": ");
          writeVal(false);
          skip();
        }
        depth--;
        nl();
      }
      pos++;
      out += c("bracket", "}");
      return;
    }

    out += token(isKey);
  }

  writeVal(false);
  if (!compact) out += "\n";
  return out;
}

export function decode(input: string): unknown {
  const scope: unknown[] = [];
  let pos = 0;

  return readVal();

  function skip(): void {
    while (pos < input.length) {
      const c = input.charCodeAt(pos);
      if (c === 0x1B && input.charCodeAt(pos + 1) === 0x5B) {
        pos += 2;
        while (pos < input.length && input.charCodeAt(pos) !== 0x6D) pos++;
        pos++;
        continue;
      }
      if (c <= 0x20) { pos++; continue; }
      break;
    }
  }

  function readVal(): unknown {
    skip();
    const ch = input.charCodeAt(pos);

    // @ reference
    if (ch === 0x40) {
      pos++;
      const start = pos;
      while (pos < input.length) {
        const c = input.charCodeAt(pos);
        if ((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7A)) pos++;
        else break;
      }
      const idx = start < pos ? parseInt(input.substring(start, pos), 36) : 0;
      return scope[idx];
    }

    // quoted string
    if (ch === 0x22) {
      const start = pos++;
      while (input.charCodeAt(pos) !== 0x22) {
        if (input.charCodeAt(pos) === 0x5C) pos++;
        pos++;
      }
      pos++;
      const val = JSON.parse(input.substring(start, pos));
      scope.push(val);
      return val;
    }

    // array — children get slots first, then the array itself
    if (ch === 0x5B) {
      pos++;
      const arr: unknown[] = [];
      skip();
      while (input.charCodeAt(pos) !== 0x5D) {
        if (arr.length > 0) { pos++; skip(); }
        arr.push(readVal());
        skip();
      }
      pos++;
      scope.push(arr);
      return arr;
    }

    // object — children get slots first, then the object itself
    if (ch === 0x7B) {
      pos++;
      const obj: Record<string, unknown> = {};
      let count = 0;
      skip();
      while (input.charCodeAt(pos) !== 0x7D) {
        if (count++ > 0) { pos++; skip(); }
        const key = readVal() as string;
        skip(); pos++; skip();
        obj[key] = readVal();
        skip();
      }
      pos++;
      scope.push(obj);
      return obj;
    }

    // number
    if (ch === 0x2D || (ch >= 0x30 && ch <= 0x39)) {
      const start = pos;
      if (ch === 0x2D) pos++;
      while (pos < input.length && input.charCodeAt(pos) >= 0x30 && input.charCodeAt(pos) <= 0x39) pos++;
      if (pos < input.length && input.charCodeAt(pos) === 0x2E) {
        pos++;
        while (pos < input.length && input.charCodeAt(pos) >= 0x30 && input.charCodeAt(pos) <= 0x39) pos++;
      }
      if (pos < input.length && (input.charCodeAt(pos) | 0x20) === 0x65) {
        pos++;
        const c2 = input.charCodeAt(pos);
        if (c2 === 0x2B || c2 === 0x2D) pos++;
        while (pos < input.length && input.charCodeAt(pos) >= 0x30 && input.charCodeAt(pos) <= 0x39) pos++;
      }
      const val = Number(input.substring(start, pos));
      scope.push(val);
      return val;
    }

    // keyword (true/false/null)
    const start = pos;
    while (pos < input.length && input.charCodeAt(pos) >= 0x61 && input.charCodeAt(pos) <= 0x7A) pos++;
    const text = input.substring(start, pos);
    if (text === "true") return true;
    if (text === "false") return false;
    return null;
  }
}
