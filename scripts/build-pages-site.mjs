import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pagesDir = join(root, "dist", "pages");

const demos = [
  "static-site",
  "mock-api",
  "sqlite",
  "postgres-pglite",
  "frontend",
  "wasi",
  "full-stack",
  "uploaded-static-blog",
  "uploaded-mock-catalog",
  "uploaded-sqlite-notes",
];

await rm(pagesDir, { recursive: true, force: true });
await mkdir(pagesDir, { recursive: true });
await cp(join(root, "web", "site"), pagesDir, { recursive: true });
await cp(join(root, "web", "studio"), join(pagesDir, "studio"), { recursive: true });

const mediaDir = join(root, "docs", "media");
if (existsSync(mediaDir)) {
  await cp(mediaDir, join(pagesDir, "media"), { recursive: true });
} else {
  console.warn("Skipping docs/media (not found); run `npm run media` to record the announcement clip.");
}

await mkdir(join(pagesDir, "demos"), { recursive: true });

const includedDemos = [];
for (const demo of demos) {
  const source = join(root, "dist", demo);
  if (!existsSync(source)) {
    console.warn(`Skipping demo "${demo}": dist/${demo} not found. Run \`make smoke\` to generate the demos first.`);
    continue;
  }
  await cp(source, join(pagesDir, "demos", demo), { recursive: true });
  includedDemos.push(demo);
}

await writeFile(join(pagesDir, ".nojekyll"), "");
await writeFile(join(pagesDir, "demos", "index.html"), demosIndex(includedDemos));

console.log(`Built GitHub Pages site at ${pagesDir} (${includedDemos.length}/${demos.length} demos).`);

function demosIndex(values) {
  const links = values
    .map((name) => `<li><a href="./${name}/">${name}</a></li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PocketStack Demos</title>
    <style>
      body { margin: 40px; font-family: system-ui, sans-serif; }
      a { color: #0d5b4f; font-weight: 700; }
      li { margin: 10px 0; }
    </style>
  </head>
  <body>
    <h1>PocketStack Demos</h1>
    <ul>
      ${links}
    </ul>
  </body>
</html>
`;
}
