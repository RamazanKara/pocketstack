import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
await cp(join(root, "site"), pagesDir, { recursive: true });
await cp(join(root, "studio"), join(pagesDir, "studio"), { recursive: true });
await cp(join(root, "docs", "media"), join(pagesDir, "media"), { recursive: true });
await mkdir(join(pagesDir, "demos"), { recursive: true });

for (const demo of demos) {
  await cp(join(root, "dist", demo), join(pagesDir, "demos", demo), { recursive: true });
}

await writeFile(join(pagesDir, ".nojekyll"), "");
await writeFile(join(pagesDir, "demos", "index.html"), demosIndex(demos));

console.log(`Built GitHub Pages site at ${pagesDir}`);

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
