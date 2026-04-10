// Self-contained benchmark — no external data files needed
import { encode, decode } from "./dd-json";

// Generate synthetic data with realistic repetition patterns
function generateData(entries: number) {
  const types = ["page", "api", "middleware", "redirect", "rewrite"];
  const regions = ["sfo1", "iad1", "cdg1", "hnd1", "pdx1"];
  const runtimes = ["nodejs20.x", "nodejs22.x", "edge"];
  const frameworks = [
    { slug: "nextjs", version: "15.1.0" },
    { slug: "remix", version: "2.5.0" },
    { slug: "astro", version: "4.2.1" },
  ];

  const routes: Record<string, unknown> = {};
  for (let i = 0; i < entries; i++) {
    const path = `/section-${i % 50}/page-${i}`;
    routes[path] = {
      contentType: "binary/octet-stream",
      type: types[i % types.length],
      lambda: {
        functionName: `fn_${(i % 20).toString(36)}`,
        deployedTo: [regions[i % regions.length]],
        runtime: runtimes[i % runtimes.length],
        framework: frameworks[i % frameworks.length],
        timeout: 900,
        maxDuration: 120,
        memorySize: 1024,
        supportsStreaming: true,
      },
    };
  }
  return routes;
}

const sizes = [100, 1000, 10000, 100000];

console.log("Entries |   JSON size |    DDJ size | reduction |  encode |  decode | ok");
console.log("--------|-------------|-------------|-----------|---------|---------|---");

for (const n of sizes) {
  const data = generateData(n);
  const json = JSON.stringify(data);

  // Warm up
  encode(data);
  if (typeof Bun !== "undefined") Bun.gc(true);

  const encRuns: number[] = [];
  let encoded = "";
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    encoded = encode(data);
    encRuns.push(performance.now() - t0);
  }

  const decRuns: number[] = [];
  let decoded: unknown;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    decoded = decode(encoded);
    decRuns.push(performance.now() - t0);
  }

  const pass = JSON.stringify(decoded) === json ? "ok" : "FAIL";
  const reduction = ((1 - encoded.length / json.length) * 100).toFixed(1);

  function fmt(bytes: number) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
  }

  console.log(
    String(n).padStart(7) +
      " | " + fmt(json.length).padStart(11) +
      " | " + fmt(encoded.length).padStart(11) +
      " | " + (reduction + "%").padStart(9) +
      " | " + (Math.min(...encRuns).toFixed(0) + "ms").padStart(7) +
      " | " + (Math.min(...decRuns).toFixed(0) + "ms").padStart(7) +
      " | " + pass
  );

  if (typeof Bun !== "undefined") Bun.gc(true);
}
