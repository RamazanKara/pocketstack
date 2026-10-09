import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const output = "dist/release";
const version = execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { encoding: "utf8" }).trim();
mkdirSync(output, { recursive: true });
rmSync(join(output, "SHA256SUMS"), { force: true });
const checksums = [];
for (const goos of ["linux", "darwin", "windows"]) {
  for (const goarch of ["amd64", "arm64"]) {
    const name = `pocketstack_${goos}_${goarch}${goos === "windows" ? ".exe" : ""}`;
    const target = join(output, name);
    execFileSync("go", [
      "build", "-trimpath", "-buildvcs=false",
      "-ldflags", `-s -w -X github.com/ramazankara/pocketstack/internal/cli.version=${version}`,
      "-o", target, "./cmd/pocketstack",
    ], { stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch } });
    const sum = createHash("sha256").update(readFileSync(target)).digest("hex");
    checksums.push(`${sum}  ${name}`);
    console.log(`Built ${name} (${version})`);
  }
}
writeFileSync(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
