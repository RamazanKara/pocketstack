package generator

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGenerateStaticDemo(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("<h1>Hello</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Mode != "browser-native" {
		t.Fatalf("mode = %s", result.Mode)
	}
	if result.Manifest.Version != "2" || !result.Manifest.BrowserOnly {
		t.Fatalf("manifest = %#v", result.Manifest)
	}
	if !strings.HasPrefix(result.Manifest.StorageNamespace, "ps-") || len(result.Manifest.StorageNamespace) != 19 {
		t.Fatalf("storage namespace = %q", result.Manifest.StorageNamespace)
	}
	if _, err := os.Stat(filepath.Join(output, "index.html")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "app.js")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "web", "static", "index.html")); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateStaticDemoCarriesConfigMountWarning(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("<h1>Hello</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "nginx"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nginx", "default.conf"), []byte("server {}"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
      - ./nginx:/etc/nginx/conf.d:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   filepath.Join(root, "dist"),
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["ignoredConfigMounts"] != "/etc/nginx/conf.d" {
		t.Fatalf("ignored config mounts = %q", service.Config["ignoredConfigMounts"])
	}
	if len(service.Warnings) != 1 || !strings.Contains(service.Warnings[0], "not emulated") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestGenerateStaticDemoCopiesDistDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "site", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte(`<script src="/dist/app.js"></script>`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "dist", "app.js"), []byte("console.log('demo')"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "out")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if len(service.Assets) != 1 || !containsString(service.Assets[0].Files, "dist/app.js") {
		t.Fatalf("static files = %#v", service.Assets)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "web", "static", "dist", "app.js")); err != nil {
		t.Fatal(err)
	}
	index, err := os.ReadFile(filepath.Join(output, "assets", "web", "static", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if string(index) != `<script src="./dist/app.js"></script>` {
		t.Fatalf("rewritten index = %q", index)
	}
}

func TestGenerateStaticDemoRewritesNestedRootRelativeURLs(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "site", "pages"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "site", "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "pages", "about.html"), []byte(`<link href="/assets/site.css"><img src="//cdn.example/logo.png">`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "assets", "site.css"), []byte(`body{background:url(/img/bg.png)} .cdn{background:url(//cdn.example/bg.png)}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "out")
	if _, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	html, err := os.ReadFile(filepath.Join(output, "assets", "web", "static", "pages", "about.html"))
	if err != nil {
		t.Fatal(err)
	}
	if string(html) != `<link href="../assets/site.css"><img src="//cdn.example/logo.png">` {
		t.Fatalf("rewritten nested html = %q", html)
	}
	css, err := os.ReadFile(filepath.Join(output, "assets", "web", "static", "assets", "site.css"))
	if err != nil {
		t.Fatal(err)
	}
	if string(css) != `body{background:url(../img/bg.png)} .cdn{background:url(//cdn.example/bg.png)}` {
		t.Fatalf("rewritten css = %q", css)
	}
}

func TestGenerateStaticDemoMergesFileAndSubdirectoryMounts(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<h1>Hello</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "assets", "app.css"), []byte("body{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./index.html:/usr/share/nginx/html/index.html:ro
      - ./assets:/usr/share/nginx/html/assets:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.BrowserPath != "assets/web/static/index.html" {
		t.Fatalf("browserPath = %q", service.BrowserPath)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "web", "static", "index.html")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "web", "static", "assets", "app.css")); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateRejectsUnsupportedProject(t *testing.T) {
	root := t.TempDir()
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  cache:
    image: redis:7-alpine
`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   filepath.Join(root, "dist"),
	})
	if err == nil {
		t.Fatal("expected unsupported project error")
	}
	if !strings.Contains(err.Error(), "browser-only") {
		t.Fatalf("error = %q", err)
	}
}

func TestGenerateMockFixturesCopiesJSONOnly(t *testing.T) {
	root := t.TempDir()
	fixtures := filepath.Join(root, "fixtures")
	if err := os.Mkdir(fixtures, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fixtures, "health.json"), []byte(`{"path":"/health","body":{"ok":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fixtures, "README.md"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.fixtures: fixtures
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if len(service.Assets) != 1 || service.Assets[0].Kind != "json-directory" {
		t.Fatalf("assets = %#v", service.Assets)
	}
	if service.Config["fixturesIndex"] != "health.json" {
		t.Fatalf("fixturesIndex = %q", service.Config["fixturesIndex"])
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "api", "fixtures", "health.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "api", "fixtures", "README.md")); !os.IsNotExist(err) {
		t.Fatalf("README.md should not be copied, stat err = %v", err)
	}
}

func TestGenerateFrontendSkipsDuplicateInstallWhenCommandInstalls(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   filepath.Join(root, "dist"),
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["install"] != "" {
		t.Fatalf("install = %q, want empty skip marker", service.Config["install"])
	}
	if service.Config["start"] != `sh -c "npm install && npm run dev -- --host 0.0.0.0"` {
		t.Fatalf("start = %q", service.Config["start"])
	}
}

func TestGenerateExplicitFrontendFromProjectRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"packageManager":"pnpm@9.1.0","scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    labels:
      pocketstack.adapter: frontend
      pocketstack.frontend.port: "5173"
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["projectPath"] != "assets/app/project" || service.Config["packageManager"] != "pnpm" {
		t.Fatalf("config = %#v", service.Config)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "app", "project", "package.json")); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateCrossOriginHostConfigs(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	if _, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"_headers", "vercel.json", "staticwebapp.config.json"} {
		data, err := os.ReadFile(filepath.Join(output, name))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), "Cross-Origin-Opener-Policy") || !strings.Contains(string(data), "Cross-Origin-Embedder-Policy") {
			t.Fatalf("%s does not contain cross-origin headers: %s", name, data)
		}
	}
}

func TestGenerateFrontendEmbedsEnvFileConfig(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("VITE_API_URL=https://api.example.test\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    env_file:
      - .env
      - path: .env.optional
        required: false
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   filepath.Join(root, "dist"),
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["env"] != "VITE_API_URL=https://api.example.test" {
		t.Fatalf("env = %q", service.Config["env"])
	}
	if !containsString(service.Warnings, "env_file values are embedded") || !containsString(service.Warnings, "optional env_file") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestGeneratePostgresInitMountCopiesSQLOnly(t *testing.T) {
	root := t.TempDir()
	initDir := filepath.Join(root, "db-init")
	if err := os.Mkdir(initDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(initDir, "01-schema.sql"), []byte("create table demo(id integer);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(initDir, "02-seed.sql"), []byte("insert into demo values (1);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(initDir, "bootstrap.sh"), []byte("#!/bin/sh\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  db:
    image: postgres:16
    volumes:
      - ./db-init:/docker-entrypoint-initdb.d:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	wantScripts := "assets/db/init-scripts/01-schema.sql\nassets/db/init-scripts/02-seed.sql"
	if service.Config["initScripts"] != wantScripts {
		t.Fatalf("initScripts = %q, want %q", service.Config["initScripts"], wantScripts)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "db", "init-scripts", "01-schema.sql")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "db", "init-scripts", "bootstrap.sh")); !os.IsNotExist(err) {
		t.Fatalf("bootstrap.sh should not be copied, stat err = %v", err)
	}
	if !containsString(service.Warnings, "non-.sql files") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestGeneratePostgresLabelSQLDirectories(t *testing.T) {
	root := t.TempDir()
	initDir := filepath.Join(root, "init")
	seedDir := filepath.Join(root, "seed")
	if err := os.Mkdir(initDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(seedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(initDir, "01-schema.sql"), []byte("create table demo(id integer);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(seedDir, "02-seed.sql"), []byte("insert into demo values (1);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(seedDir, "README.md"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  db:
    image: postgres:16
    labels:
      pocketstack.db.init: init
      pocketstack.db.seed: seed
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["initScripts"] != "assets/db/init-scripts/01-schema.sql" {
		t.Fatalf("initScripts = %q", service.Config["initScripts"])
	}
	if service.Config["seedScripts"] != "assets/db/seed-scripts/02-seed.sql" {
		t.Fatalf("seedScripts = %q", service.Config["seedScripts"])
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "db", "seed-scripts", "README.md")); !os.IsNotExist(err) {
		t.Fatalf("README.md should not be copied, stat err = %v", err)
	}
}

func TestGenerateSQLiteSeedDatabaseKeepsExtension(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "seed.sqlite3"), []byte("SQLite format 3\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.seed: seed.sqlite3
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["seedPath"] != "assets/db/seed.sqlite3" {
		t.Fatalf("seedPath = %q", service.Config["seedPath"])
	}
	if service.Config["storageNamespace"] != result.Manifest.StorageNamespace {
		t.Fatalf("storageNamespace = %q, want %q", service.Config["storageNamespace"], result.Manifest.StorageNamespace)
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "db", "seed.sqlite3")); err != nil {
		t.Fatal(err)
	}
}

func TestGenerateSQLiteSQLDirectories(t *testing.T) {
	root := t.TempDir()
	initDir := filepath.Join(root, "init")
	seedDir := filepath.Join(root, "seed")
	if err := os.Mkdir(initDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(seedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(initDir, "01-schema.sql"), []byte("create table notes(body text);\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(initDir, "README.md"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(seedDir, "02-seed.sql"), []byte("insert into notes values ('hello');\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.init: init
      pocketstack.db.seed: seed
`), 0o644); err != nil {
		t.Fatal(err)
	}

	output := filepath.Join(root, "dist")
	result, err := Generate(Options{
		ComposeFile: composeFile,
		OutputDir:   output,
		GeneratedAt: time.Unix(0, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := result.Manifest.Services[0]
	if service.Config["initScripts"] != "assets/db/init-scripts/01-schema.sql" {
		t.Fatalf("initScripts = %q", service.Config["initScripts"])
	}
	if service.Config["seedScripts"] != "assets/db/seed-scripts/02-seed.sql" {
		t.Fatalf("seedScripts = %q", service.Config["seedScripts"])
	}
	if _, err := os.Stat(filepath.Join(output, "assets", "db", "init-scripts", "README.md")); !os.IsNotExist(err) {
		t.Fatalf("README.md should not be copied, stat err = %v", err)
	}
	if !containsString(service.Warnings, "non-.sql files") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func containsString(values []string, substring string) bool {
	for _, value := range values {
		if strings.Contains(value, substring) {
			return true
		}
	}
	return false
}
