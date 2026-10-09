import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const directory = "dist/release";
const lines = readFileSync(join(directory, "SHA256SUMS"), "utf8").trim().split("\n");
for (const line of lines) {
  const [expected, name] = line.split("  ");
  const actual = createHash("sha256").update(readFileSync(join(directory, name))).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch: ${name}`);
  console.log(`${name}: OK`);
}
