import { describe, expect, test } from "bun:test";
import { decode, encode } from "./dd-json";

describe("encode / decode roundtrip", () => {
  const cases: [string, unknown][] = [
    ["null", null],
    ["true", true],
    ["false", false],
    ["integer", 42],
    ["negative number", -3.14],
    ["string", "hello"],
    ["empty string", ""],
    ["empty array", []],
    ["empty object", {}],
    ["nested object", { a: 1, b: { c: "deep" } }],
    ["array of mixed types", [1, "two", null, true, { key: "val" }]],
  ];
  for (const [name, value] of cases) {
    test(`round-trips ${name}`, () => {
      expect(decode(encode(value))).toStrictEqual(value);
    });
  }
});

describe("deduplication", () => {
  test("deduplicates repeated strings", () => {
    const input = { name: "Alice", friend: "Alice" };
    const encoded = encode(input);
    expect(encoded).toContain("@");
    expect(decode(encoded)).toStrictEqual(input);
  });

  test("deduplicates repeated objects", () => {
    const item = { x: 1, y: 2 };
    const input = [item, item];
    const encoded = encode(input);
    expect(encoded).toContain("@");
    expect(decode(encoded)).toStrictEqual(input);
  });

  test("deduplicates repeated keys across objects", () => {
    const input = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }];
    const encoded = encode(input);
    expect(encoded.split('"name"').length - 1).toBe(1);
    expect(decode(encoded)).toStrictEqual(input);
  });

  test("does not deduplicate null/true/false", () => {
    const input = [null, null, true, true, false, false];
    const encoded = encode(input);
    expect(encoded).not.toContain("@");
    expect(decode(encoded)).toStrictEqual(input);
  });
});

describe("size", () => {
  test("never larger than JSON.stringify", () => {
    const data = {
      routes: [
        { src: "^/api/(.*)$", dest: "/api/$1", methods: ["GET", "POST"] },
        { src: "^/api/(.*)$", dest: "/api/$1", methods: ["GET", "POST"] },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    };
    expect(encode(data).length).toBeLessThanOrEqual(JSON.stringify(data).length);
  });

  test("compresses repetitive data", () => {
    const routes = Array.from({ length: 20 }, (_, i) => ({
      src: `^/page-${i}$`, dest: `/pages/page-${i}.html`,
      status: 200, headers: { "cache-control": "public, max-age=3600" },
    }));
    const ddj = encode(routes);
    expect(ddj.length).toBeLessThan(JSON.stringify(routes).length * 0.85);
    expect(decode(ddj)).toStrictEqual(routes);
  });
});

describe("JSON.stringify parity", () => {
  const cases: [string, unknown][] = [
    ["undefined in array", [undefined, 1, undefined]],
    ["function in array", [() => {}, "a"]],
    ["symbol in array", [Symbol("x"), 42]],
    ["undefined as object value", { a: undefined, b: 1 }],
    ["function as object value", { fn: () => {}, b: 2 }],
    ["symbol as object value", { s: Symbol("x"), b: 3 }],
    ["Date object", new Date("2026-01-15T00:00:00.000Z")],
    ["Date in array", [new Date("2026-01-15T00:00:00.000Z")]],
    ["Date as object value", { d: new Date("2026-01-15") }],
    ["RegExp", /foo/gi],
    ["RegExp in object", { pattern: /bar/ }],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["NaN in array", [NaN, Infinity, -Infinity]],
    ["repeated NaN", [NaN, NaN, NaN]],
    ["repeated Infinity", [Infinity, Infinity]],
    ["mixed non-JSON in object", { a: 1, b: undefined, c: () => {}, d: "keep", e: Symbol("x") }],
  ];
  for (const [name, value] of cases) {
    test(`matches JSON.parse(JSON.stringify()) for ${name}`, () => {
      expect(decode(encode(value))).toStrictEqual(JSON.parse(JSON.stringify(value)));
    });
  }

  test("throws TypeError for BigInt", () => {
    expect(() => encode(BigInt(1))).toThrow(TypeError);
  });

  test("throws TypeError for BigInt in object", () => {
    expect(() => encode({ id: BigInt("9007199254740993") })).toThrow(TypeError);
  });

  test("throws TypeError for BigInt in array", () => {
    expect(() => encode([BigInt(0)])).toThrow(TypeError);
  });
});

describe("decode", () => {
  test("decodes standard JSON", () => {
    expect(decode('{"key":"value","list":[1,2,3]}')).toStrictEqual({ key: "value", list: [1, 2, 3] });
  });

  test("ignores whitespace", () => {
    expect(decode('{\n  "a": 1,\n  "b": 2\n}')).toStrictEqual({ a: 1, b: 2 });
  });
});
