// deduplicated JSON
// The idea is simple, this is a superset of JSON with a few changes
// (..., val) creates a scope,
//   any value in the scope can reference earlier values by integer index.
// @[idx] is a reference to an earlier value encoded as varints
// 0-9, a-z, A-Z, -, _ are the 64 digits used for encoding (not standard base64url order).
//  `@` references the first item (offset 0)
//  `@1` references the second item (offset 1)
//  `@a` references the 11th item (offset 10)
//  `@A` references the 37th item (offset 36)
//  `@Z` references the 62nd item (offset 61)
//  `@-` references the 63rd item (offset 62)
//  `@_` references the 64th item (offset 63)
//  `@10` references the 65th item (offset 64)
// strings can be bare when not ambiguous
//  - cannot contain []{}(),:"@`\ or whitespace
//  - must start with a letter, or one of _/$
//  - /^[a-zA-Z_/$][^\[\]{}(),:"@`\\\s]*$/
//  - cannot be "true", "false", or "null"

export function encode(rootValue: unknown): string {
  const bareStringRe = /^[a-zA-Z_/$][^\[\]{}(),:"@`\\\s]*$/;
  const keyMap = new Map<string | number | object, string>();
  // Only track values seen 2+ times (actual duplicates)
  const dupValues: (string | number | object)[] = [];
  // 1 = seen once, 2 = duplicate confirmed (single object replaces two Sets)
  const keyState: Record<string, number> = Object.create(null);
  const minKey = 4;
  const maxKey = 2048;

  walkMap(rootValue);

  // Pre-compute reference strings: avoids toString(36) + concat in hot path
  const refs: Record<string, string> = Object.create(null);
  let result = "(";
  let sep = "";
  for (let i = 0; i < dupValues.length; i++) {
    const entry = dupValues[i];
    const index = i;
    result += sep + encodeEntry(entry);
    sep = ",";
    refs[keyMap.get(entry)!] = "@" + index.toString(36);
  }
  result += sep + encodeEntry(rootValue) + ")";
  return result;

  function encodeEntry(val: unknown): string {
    // Type-split paths for monomorphic inline caches
    if (typeof val === "string") {
      const key = keyMap.get(val);
      if (key !== undefined) {
        const ref = refs[key];
        if (ref !== undefined) return ref;
      }
      if (val !== "true" && val !== "false" && val !== "null" && bareStringRe.test(val)) return val;
      return JSON.stringify(val);
    }
    if (typeof val === "number") {
      const key = keyMap.get(val);
      if (key !== undefined) {
        const ref = refs[key];
        if (ref !== undefined) return ref;
      }
      return JSON.stringify(val);
    }
    if (val === null || val === undefined || typeof val === "boolean") return JSON.stringify(val);
    // object or array
    const key = keyMap.get(val as object);
    if (key !== undefined) {
      const ref = refs[key];
      if (ref !== undefined) return ref;
    }
    if (Array.isArray(val)) {
      // Loop + concat instead of .map().join() — avoids intermediate array
      const len = val.length;
      if (len === 0) return "[]";
      let result = "[" + encodeEntry(val[0]);
      for (let i = 1; i < len; i++) result += "," + encodeEntry(val[i]);
      return result + "]";
    }
    // Object.keys + indexed access instead of Object.entries (avoids [k,v] pair alloc)
    const keys = Object.keys(val);
    const len = keys.length;
    if (len === 0) return "{}";
    const obj = val as Record<string, unknown>;
    let result = "{" + encodeEntry(keys[0]) + ":" + encodeEntry(obj[keys[0]]);
    for (let i = 1; i < len; i++) result += "," + encodeEntry(keys[i]) + ":" + encodeEntry(obj[keys[i]]);
    return result + "}";
  }

  function walkMap(val: unknown): string | undefined {
    if (typeof val === "string" || typeof val === "number") {
      // Cache hit avoids redundant JSON.stringify
      const existing = keyMap.get(val);
      if (existing !== undefined) {
        if (keyState[existing] === 1) {
          keyState[existing] = 2;
          dupValues.push(val);
        }
        return existing;
      }
      const key = JSON.stringify(val);
      if (key.length >= minKey) {
        keyMap.set(val, key);
        keyState[key] = 1;
      }
      return key;
    }
    if (!val || typeof val !== "object") return JSON.stringify(val);
    const cached = keyMap.get(val);
    if (cached !== undefined) return cached;

    if (Array.isArray(val)) {
      let key = "[";
      let size = 1;
      let tooBig = false;
      let sep = "";
      for (let i = 0; i < val.length; i++) {
        const child = walkMap(val[i]);
        if (tooBig) continue;
        if (child === undefined) { tooBig = true; continue; }
        size += child.length + 1;
        if (size > maxKey) { tooBig = true; continue; }
        key += sep + child;
        sep = ",";
      }
      if (tooBig) return undefined;
      key += "]";
      if (key.length >= minKey) {
        keyMap.set(val, key);
        const s = keyState[key];
        if (s === 1) { keyState[key] = 2; dupValues.push(val); }
        else if (s === undefined) { keyState[key] = 1; }
      }
      return key;
    }

    const objKeys = Object.keys(val);
    const obj = val as Record<string, unknown>;
    let key = "{";
    let size = 1;
    let tooBig = false;
    let sep = "";
    for (let i = 0; i < objKeys.length; i++) {
      const kKey = walkMap(objKeys[i]);
      const vKey = walkMap(obj[objKeys[i]]);
      if (tooBig) continue;
      if (kKey === undefined || vKey === undefined) { tooBig = true; continue; }
      size += kKey.length + vKey.length + 2;
      if (size > maxKey) { tooBig = true; continue; }
      key += sep + kKey + ":" + vKey;
      sep = ",";
    }
    if (tooBig) return undefined;
    key += "}";
    if (key.length >= minKey) {
      keyMap.set(val, key);
      const s = keyState[key];
      if (s === 1) { keyState[key] = 2; dupValues.push(val); }
      else if (s === undefined) { keyState[key] = 1; }
    }
    return key;
  }
}

function humanizeBytes(bytes: string): string {
  const data = new TextEncoder().encode(bytes);
  let length = data.byteLength;
  if (length < 1024) return `${length} B`;
  length /= 1024;
  if (length < 1024) return `${(length).toFixed(2)} KB`;
  length /= 1024;
  if (length < 1024) return `${(length).toFixed(2)} MB`;
  length /= 1024;
  return `${(length).toFixed(2)} GB`;
}

let data = require('./large2.json');
// data = Object.fromEntries(Object.entries(data).slice(0, 100));
const json = JSON.stringify(data);

for (let i = 0; i < 10; i++) {
  console.time("encode");
  const encoded = encode(data);
  console.timeEnd("encode");
  // console.log(encoded)
  console.log(`ORIGINAL JSON: ${humanizeBytes(json)}`)
  console.log(`DEDUPLICATED JSON: ${humanizeBytes(encoded)}`)
}
