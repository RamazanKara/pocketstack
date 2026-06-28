package compose

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAnalyzeStaticNginxProject(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./site:/usr/share/nginx/html:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Mode != ModeBrowserNative {
		t.Fatalf("mode = %s, want %s", analysis.Mode, ModeBrowserNative)
	}
	if len(analysis.Services) != 1 || !analysis.Services[0].BrowserNative {
		t.Fatalf("service analysis = %#v", analysis.Services)
	}
	if analysis.Readiness.Status != "ready" || analysis.Readiness.Score != 100 {
		t.Fatalf("readiness = %#v", analysis.Readiness)
	}
}

func TestAnalyzeUnsupportedServiceIncludesReadinessAndSuggestions(t *testing.T) {
	root := t.TempDir()
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  cache:
    image: redis:7
    ports:
      - "6379:6379"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Mode != ModeUnsupported || analysis.BrowserNative {
		t.Fatalf("analysis = %#v", analysis)
	}
	if analysis.Readiness.Status != "blocked" || analysis.Readiness.Score != 0 || analysis.Readiness.TotalServices != 1 {
		t.Fatalf("readiness = %#v", analysis.Readiness)
	}
	service := analysis.Services[0]
	if len(service.Suggestions) == 0 {
		t.Fatalf("suggestions were not generated: %#v", service)
	}
	if !containsReason(service.Suggestions, "replace this stateful service") {
		t.Fatalf("suggestions = %#v", service.Suggestions)
	}
	if len(analysis.NextSteps) == 0 || !strings.Contains(analysis.NextSteps[0], "cache:") {
		t.Fatalf("next steps = %#v", analysis.NextSteps)
	}
}

func TestAnalyzeStaticWebWarnsForServerConfigMounts(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("hello"), 0o644); err != nil {
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
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if service.Adapter != AdapterStaticWeb || !service.BrowserNative {
		t.Fatalf("service = %#v", service)
	}
	if service.Config["ignoredConfigMounts"] != "/etc/nginx/conf.d" {
		t.Fatalf("ignored config mounts = %q", service.Config["ignoredConfigMounts"])
	}
	if len(service.Warnings) != 1 || !strings.Contains(service.Warnings[0], "not emulated") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestAnalyzeStaticWebFileAndSubdirectoryMounts(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("hello"), 0o644); err != nil {
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

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterStaticWeb || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if len(service.Assets) != 2 {
		t.Fatalf("assets = %#v", service.Assets)
	}
	targets := []string{service.Assets[0].Target, service.Assets[1].Target}
	if strings.Join(targets, "\n") != "static/index.html\nstatic/assets" {
		t.Fatalf("asset targets = %#v", targets)
	}
}

func TestAnalyzeStaticWebExplicitLabelIsUnsupported(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    labels:
      pocketstack.adapter: static-web
    volumes:
      - ./site:/usr/share/nginx/html:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeUnsupported || service.Adapter != AdapterUnsupported || service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if !containsReason(service.Unsupported, "static-web is autodetected") {
		t.Fatalf("unsupported = %#v", service.Unsupported)
	}
}

func TestAnalyzeFrontendProject(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    working_dir: /workspace
    command: npm run dev
    environment:
      VITE_API_URL: https://api.example.test
      VITE_FEATURE_FLAG: "true"
    ports:
      - "5173:5173"
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Mode != ModeBrowserNative || analysis.Services[0].Adapter != AdapterFrontend {
		t.Fatalf("analysis = %#v", analysis)
	}
	if !analysis.HostRequirements.CrossOriginIsolationRequired {
		t.Fatalf("frontend should require cross-origin isolation")
	}
	if analysis.Services[0].Config["env"] != "VITE_API_URL=https://api.example.test\nVITE_FEATURE_FLAG=true" {
		t.Fatalf("frontend env = %q", analysis.Services[0].Config["env"])
	}
}

func TestAnalyzeFrontendEnvFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte(`
VITE_API_URL=https://from-env-file.example.test
VITE_SHARED=file
export VITE_EXPORTED=yes
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env.local"), []byte(`
VITE_LOCAL=local
VITE_SHARED=local-file
`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    env_file:
      - .env
      - path: .env.local
    environment:
      VITE_SHARED: inline
      VITE_FLAG: "true"
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterFrontend || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	wantEnv := "VITE_API_URL=https://from-env-file.example.test\nVITE_EXPORTED=yes\nVITE_FLAG=true\nVITE_LOCAL=local\nVITE_SHARED=inline"
	if service.Config["env"] != wantEnv {
		t.Fatalf("frontend env = %q, want %q", service.Config["env"], wantEnv)
	}
	if !containsReason(service.Warnings, "env_file values are embedded") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestAnalyzeFrontendOptionalEnvFileCanBeMissing(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("VITE_PRESENT=yes\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    env_file:
      - path: .env.optional
        required: false
      - .env
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterFrontend || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if service.Config["env"] != "VITE_PRESENT=yes" {
		t.Fatalf("frontend env = %q", service.Config["env"])
	}
	if !containsReason(service.Warnings, "optional env_file") || !containsReason(service.Warnings, "env_file values are embedded") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestAnalyzeFrontendMissingEnvFileUnsupported(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    env_file: .env.missing
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeUnsupported || service.Adapter != AdapterUnsupported || service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if !containsReason(service.Unsupported, "env_file") {
		t.Fatalf("unsupported = %#v", service.Unsupported)
	}
}

func TestAnalyzeFrontendPackageManagers(t *testing.T) {
	tests := []struct {
		name            string
		image           string
		packageJSON     string
		lockFile        string
		expectedPM      string
		expectedInstall string
		expectedStart   string
	}{
		{
			name:            "npm lock",
			image:           "node:22-alpine",
			packageJSON:     `{"scripts":{"dev":"vite"}}`,
			lockFile:        "package-lock.json",
			expectedPM:      "npm",
			expectedInstall: "npm ci",
			expectedStart:   "npm run dev -- --host 0.0.0.0",
		},
		{
			name:            "pnpm packageManager",
			image:           "node:22-alpine",
			packageJSON:     `{"packageManager":"pnpm@9.0.0","scripts":{"dev":"vite"}}`,
			expectedPM:      "pnpm",
			expectedInstall: "pnpm install",
			expectedStart:   "pnpm run dev -- --host 0.0.0.0",
		},
		{
			name:            "yarn lock start script",
			image:           "node:22-alpine",
			packageJSON:     `{"scripts":{"start":"vite --host 0.0.0.0"}}`,
			lockFile:        "yarn.lock",
			expectedPM:      "yarn",
			expectedInstall: "yarn install",
			expectedStart:   "yarn run start -- --host 0.0.0.0",
		},
		{
			name:            "bun image",
			image:           "oven/bun:1",
			packageJSON:     `{"scripts":{"dev":"vite"}}`,
			expectedPM:      "bun",
			expectedInstall: "bun install",
			expectedStart:   "bun run dev -- --host 0.0.0.0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(tt.packageJSON), 0o644); err != nil {
				t.Fatal(err)
			}
			if tt.lockFile != "" {
				if err := os.WriteFile(filepath.Join(root, tt.lockFile), []byte("lock"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			composeFile := filepath.Join(root, "compose.yaml")
			if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: `+tt.image+`
    volumes:
      - .:/workspace
`), 0o644); err != nil {
				t.Fatal(err)
			}
			analysis, err := AnalyzeFile(composeFile)
			if err != nil {
				t.Fatal(err)
			}
			service := analysis.Services[0]
			if service.Adapter != AdapterFrontend || !service.BrowserNative {
				t.Fatalf("service = %#v", service)
			}
			if service.Config["packageManager"] != tt.expectedPM ||
				service.Config["install"] != tt.expectedInstall ||
				service.Config["start"] != tt.expectedStart {
				t.Fatalf("config = %#v", service.Config)
			}
		})
	}
}

func TestAnalyzeExplicitFrontendProjectRootWithoutImage(t *testing.T) {
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

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterFrontend || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if service.AssetSource != root {
		t.Fatalf("asset source = %q, want %q", service.AssetSource, root)
	}
	if service.Config["packageManager"] != "pnpm" || service.Config["install"] != "pnpm install" ||
		service.Config["start"] != "pnpm run dev -- --host 0.0.0.0" || service.Config["port"] != "5173" {
		t.Fatalf("config = %#v", service.Config)
	}
}

func TestAnalyzeFrontendWorkingDirInsideBindMount(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "apps", "web")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    working_dir: /workspace/apps/web
    volumes:
      - .:/workspace
`), 0o644); err != nil {
		t.Fatal(err)
	}

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if service.Adapter != AdapterFrontend || !service.BrowserNative {
		t.Fatalf("service = %#v", service)
	}
	if service.AssetSource != appDir {
		t.Fatalf("asset source = %q, want %q", service.AssetSource, appDir)
	}
	if service.Config["start"] != "npm run dev -- --host 0.0.0.0" {
		t.Fatalf("start = %q", service.Config["start"])
	}
}

func TestAnalyzeFrontendUsesComposeCommand(t *testing.T) {
	tests := []struct {
		name            string
		entrypoint      string
		command         string
		labels          string
		expectedInstall string
		expectedStart   string
	}{
		{
			name: "string command",
			command: `
    command: npm run preview -- --host 0.0.0.0
`,
			expectedInstall: "npm install",
			expectedStart:   "npm run preview -- --host 0.0.0.0",
		},
		{
			name: "list command",
			command: `
    command:
      - npm
      - run
      - dev
      - --
      - --host
      - 0.0.0.0
`,
			expectedInstall: "npm install",
			expectedStart:   "npm run dev -- --host 0.0.0.0",
		},
		{
			name: "label overrides command",
			command: `
    command: npm run dev
`,
			labels: `
    labels:
      pocketstack.frontend.start: pnpm dev -- --host 0.0.0.0
`,
			expectedInstall: "npm install",
			expectedStart:   "pnpm dev -- --host 0.0.0.0",
		},
		{
			name: "compose command already installs",
			command: `
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
`,
			expectedInstall: "",
			expectedStart:   `sh -c "npm install && npm run dev -- --host 0.0.0.0"`,
		},
		{
			name: "explicit install label overrides detection",
			command: `
    command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
`,
			labels: `
    labels:
      pocketstack.frontend.install: npm ci
`,
			expectedInstall: "npm ci",
			expectedStart:   `sh -c "npm install && npm run dev -- --host 0.0.0.0"`,
		},
		{
			name: "entrypoint and list command",
			entrypoint: `
    entrypoint:
      - npm
      - run
`,
			command: `
    command:
      - dev
      - --
      - --host
      - 0.0.0.0
`,
			expectedInstall: "npm install",
			expectedStart:   "npm run dev -- --host 0.0.0.0",
		},
		{
			name: "shell entrypoint quotes string command",
			entrypoint: `
    entrypoint:
      - sh
      - -c
`,
			command: `
    command: npm install && npm run dev -- --host 0.0.0.0
`,
			expectedInstall: "",
			expectedStart:   `sh -c "npm install && npm run dev -- --host 0.0.0.0"`,
		},
		{
			name: "label overrides entrypoint and command",
			entrypoint: `
    entrypoint: npm
`,
			command: `
    command: run dev
`,
			labels: `
    labels:
      pocketstack.frontend.start: yarn dev --host 0.0.0.0
`,
			expectedInstall: "npm install",
			expectedStart:   "yarn dev --host 0.0.0.0",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"preview":"vite --preview","dev":"vite"}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			composeFile := filepath.Join(root, "compose.yaml")
			if err := os.WriteFile(composeFile, []byte(`
services:
  app:
    image: node:22-alpine
    volumes:
      - .:/workspace
`+tt.entrypoint+tt.command+tt.labels), 0o644); err != nil {
				t.Fatal(err)
			}

			analysis, err := AnalyzeFile(composeFile)
			if err != nil {
				t.Fatal(err)
			}
			service := analysis.Services[0]
			if service.Adapter != AdapterFrontend || !service.BrowserNative {
				t.Fatalf("service = %#v", service)
			}
			if service.Config["start"] != tt.expectedStart {
				t.Fatalf("start = %q, want %q", service.Config["start"], tt.expectedStart)
			}
			if service.Config["install"] != tt.expectedInstall {
				t.Fatalf("install = %q, want %q", service.Config["install"], tt.expectedInstall)
			}
		})
	}
}

func TestAnalyzeExplicitAdapters(t *testing.T) {
	root := t.TempDir()
	mustWrite := func(path, body string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite(filepath.Join(root, "hello.wasm"), "\x00asm\x01\x00\x00\x00")
	mustWrite(filepath.Join(root, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: Demo\n  version: 1\npaths: {}\n")
	mustWrite(filepath.Join(root, "fixtures", "health.json"), `{"method":"GET","path":"/health","body":{"ok":true}}`)
	mustWrite(filepath.Join(root, "init.sql"), "create table demo(id integer);\n")
	composeFile := filepath.Join(root, "compose.yaml")
	mustWrite(composeFile, `
services:
  wasm:
    image: scratch
    environment:
      MODE: demo
      API_URL: https://example.test
    labels:
      pocketstack.adapter: wasi
      pocketstack.wasi.module: hello.wasm
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.openapi: openapi.yaml
      pocketstack.mock.fixtures: fixtures
  db:
    image: postgres:16-alpine
    labels:
      pocketstack.db.init: init.sql
  sqlite:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.init: init.sql
`)
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Mode != ModeBrowserNative || len(analysis.Services) != 4 {
		t.Fatalf("analysis = %#v", analysis)
	}
	byName := map[string]ServiceAnalysis{}
	for _, service := range analysis.Services {
		byName[service.Name] = service
	}
	want := map[string]string{
		"api":    AdapterMockHTTP,
		"db":     AdapterPostgresPGlite,
		"sqlite": AdapterSQLite,
		"wasm":   AdapterWASI,
	}
	for name, adapter := range want {
		if byName[name].Adapter != adapter || !byName[name].BrowserNative {
			t.Fatalf("%s = %#v, want adapter %s", name, byName[name], adapter)
		}
	}
	if byName["wasm"].Config["env"] != "API_URL=https://example.test\nMODE=demo" {
		t.Fatalf("wasi env = %q", byName["wasm"].Config["env"])
	}
	if !byName["wasm"].HostRequirements.CrossOriginIsolationRequired || !analysis.HostRequirements.CrossOriginIsolationRequired {
		t.Fatalf("wasi host requirements = %#v, analysis = %#v", byName["wasm"].HostRequirements, analysis.HostRequirements)
	}
}

func TestAnalyzeMockHTTPValidatesOpenAPIAndJSONFixtures(t *testing.T) {
	t.Run("OpenAPI file must be yaml or json", func(t *testing.T) {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "openapi.txt"), []byte("paths: {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		composeFile := filepath.Join(root, "compose.yaml")
		if err := os.WriteFile(composeFile, []byte(`
services:
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.openapi: openapi.txt
`), 0o644); err != nil {
			t.Fatal(err)
		}

		analysis, err := AnalyzeFile(composeFile)
		if err != nil {
			t.Fatal(err)
		}
		service := analysis.Services[0]
		if analysis.Mode != ModeUnsupported || service.Adapter != AdapterUnsupported || service.BrowserNative {
			t.Fatalf("analysis = %#v, service = %#v", analysis, service)
		}
		if !containsReason(service.Unsupported, "must be .yaml, .yml, or .json") {
			t.Fatalf("unsupported = %#v", service.Unsupported)
		}
	})

	t.Run("fixtures-only service needs JSON fixtures", func(t *testing.T) {
		root := t.TempDir()
		if err := os.Mkdir(filepath.Join(root, "fixtures"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "fixtures", "README.md"), []byte("ignored"), 0o644); err != nil {
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

		analysis, err := AnalyzeFile(composeFile)
		if err != nil {
			t.Fatal(err)
		}
		service := analysis.Services[0]
		if analysis.Mode != ModeUnsupported || service.Adapter != AdapterUnsupported || service.BrowserNative {
			t.Fatalf("analysis = %#v, service = %#v", analysis, service)
		}
		if !containsReason(service.Unsupported, "has no .json files") {
			t.Fatalf("unsupported = %#v", service.Unsupported)
		}
	})

	t.Run("mixed fixtures are filtered and warned", func(t *testing.T) {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "openapi.yaml"), []byte("openapi: 3.0.0\ninfo:\n  title: Demo\n  version: 1\npaths: {}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(filepath.Join(root, "fixtures"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "fixtures", "health.json"), []byte(`{"path":"/health"}`), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "fixtures", "README.md"), []byte("ignored"), 0o644); err != nil {
			t.Fatal(err)
		}
		composeFile := filepath.Join(root, "compose.yaml")
		if err := os.WriteFile(composeFile, []byte(`
services:
  api:
    image: scratch
    labels:
      pocketstack.adapter: mock-http
      pocketstack.mock.openapi: openapi.yaml
      pocketstack.mock.fixtures: fixtures
`), 0o644); err != nil {
			t.Fatal(err)
		}

		analysis, err := AnalyzeFile(composeFile)
		if err != nil {
			t.Fatal(err)
		}
		service := analysis.Services[0]
		if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterMockHTTP || !service.BrowserNative {
			t.Fatalf("analysis = %#v, service = %#v", analysis, service)
		}
		if len(service.Assets) != 2 || service.Assets[1].Name != "fixtures" || service.Assets[1].Kind != "json-directory" {
			t.Fatalf("assets = %#v", service.Assets)
		}
		if !containsReason(service.Warnings, "non-.json files") {
			t.Fatalf("warnings = %#v", service.Warnings)
		}
	})
}

func TestAnalyzeSQLiteSeedPreservesDatabaseExtension(t *testing.T) {
	root := t.TempDir()
	seed := filepath.Join(root, "seed.sqlite3")
	if err := os.WriteFile(seed, []byte("SQLite format 3\x00"), 0o644); err != nil {
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

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Services[0].Adapter != AdapterSQLite || !analysis.Services[0].BrowserNative {
		t.Fatalf("analysis = %#v", analysis.Services[0])
	}
	if len(analysis.Services[0].Assets) != 1 || analysis.Services[0].Assets[0].Target != "seed.sqlite3" {
		t.Fatalf("assets = %#v, want seed.sqlite3 target", analysis.Services[0].Assets)
	}
}

func TestAnalyzeSQLiteSQLDirectories(t *testing.T) {
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

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterSQLite || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if len(service.Assets) != 2 || service.Assets[0].Name != "init-scripts" || service.Assets[1].Name != "seed-scripts" {
		t.Fatalf("assets = %#v", service.Assets)
	}
	if !containsReason(service.Warnings, "non-.sql files") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestAnalyzePostgresInitMount(t *testing.T) {
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

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterPostgresPGlite || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if len(service.Assets) != 1 || service.Assets[0].Name != "init-scripts" || service.Assets[0].Kind != "sql-directory" {
		t.Fatalf("assets = %#v", service.Assets)
	}
	if !containsReason(service.Warnings, "non-.sql files") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestAnalyzeDBPersistModes(t *testing.T) {
	tests := []struct {
		name              string
		compose           string
		wantAdapter       string
		wantPersist       string
		wantUnsupported   bool
		wantUnsupportedIn string
	}{
		{
			name: "postgres memory",
			compose: `
services:
  db:
    image: postgres:16
    labels:
      pocketstack.adapter: postgres-pglite
      pocketstack.db.persist: memory
`,
			wantAdapter: AdapterPostgresPGlite,
			wantPersist: "memory",
		},
		{
			name: "sqlite memory",
			compose: `
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.persist: memory
`,
			wantAdapter: AdapterSQLite,
			wantPersist: "memory",
		},
		{
			name: "postgres invalid",
			compose: `
services:
  db:
    image: postgres:16
    labels:
      pocketstack.adapter: postgres-pglite
      pocketstack.db.persist: localstorage
`,
			wantUnsupported:   true,
			wantUnsupportedIn: "pocketstack.db.persist must be indexeddb or memory",
		},
		{
			name: "sqlite invalid",
			compose: `
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.persist: localstorage
`,
			wantUnsupported:   true,
			wantUnsupportedIn: "pocketstack.db.persist must be indexeddb or memory",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			composeFile := filepath.Join(root, "compose.yaml")
			if err := os.WriteFile(composeFile, []byte(tt.compose), 0o644); err != nil {
				t.Fatal(err)
			}

			analysis, err := AnalyzeFile(composeFile)
			if err != nil {
				t.Fatal(err)
			}
			service := analysis.Services[0]
			if tt.wantUnsupported {
				if analysis.Mode != ModeUnsupported || service.Adapter != AdapterUnsupported || service.BrowserNative {
					t.Fatalf("analysis = %#v, service = %#v", analysis, service)
				}
				if !containsReason(service.Unsupported, tt.wantUnsupportedIn) {
					t.Fatalf("unsupported = %#v, want substring %q", service.Unsupported, tt.wantUnsupportedIn)
				}
				return
			}
			if analysis.Mode != ModeBrowserNative || service.Adapter != tt.wantAdapter || !service.BrowserNative {
				t.Fatalf("analysis = %#v, service = %#v", analysis, service)
			}
			if service.Config["persist"] != tt.wantPersist {
				t.Fatalf("persist = %q, want %q", service.Config["persist"], tt.wantPersist)
			}
		})
	}
}

func TestAnalyzeDBLabelsRejectUnsupportedFileTypes(t *testing.T) {
	tests := []struct {
		name              string
		file              string
		compose           string
		wantUnsupportedIn string
	}{
		{
			name: "postgres seed must be sql",
			file: "seed.json",
			compose: `
services:
  db:
    image: postgres:16
    labels:
      pocketstack.db.seed: seed.json
`,
			wantUnsupportedIn: "must be .sql",
		},
		{
			name: "sqlite init must be sql",
			file: "schema.txt",
			compose: `
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.init: schema.txt
`,
			wantUnsupportedIn: "must be .sql",
		},
		{
			name: "sqlite seed only allows sql or database files",
			file: "seed.csv",
			compose: `
services:
  db:
    image: scratch
    labels:
      pocketstack.adapter: sqlite
      pocketstack.db.seed: seed.csv
`,
			wantUnsupportedIn: "must be .sql, .db, .sqlite, or .sqlite3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, tt.file), []byte("not sql"), 0o644); err != nil {
				t.Fatal(err)
			}
			composeFile := filepath.Join(root, "compose.yaml")
			if err := os.WriteFile(composeFile, []byte(tt.compose), 0o644); err != nil {
				t.Fatal(err)
			}

			analysis, err := AnalyzeFile(composeFile)
			if err != nil {
				t.Fatal(err)
			}
			service := analysis.Services[0]
			if analysis.Mode != ModeUnsupported || service.Adapter != AdapterUnsupported || service.BrowserNative {
				t.Fatalf("analysis = %#v, service = %#v", analysis, service)
			}
			if !containsReason(service.Unsupported, tt.wantUnsupportedIn) {
				t.Fatalf("unsupported = %#v, want substring %q", service.Unsupported, tt.wantUnsupportedIn)
			}
		})
	}
}

func TestAnalyzePostgresLabelSQLDirectories(t *testing.T) {
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

	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if analysis.Mode != ModeBrowserNative || service.Adapter != AdapterPostgresPGlite || !service.BrowserNative {
		t.Fatalf("analysis = %#v, service = %#v", analysis, service)
	}
	if len(service.Assets) != 2 || service.Assets[0].Name != "init-scripts" || service.Assets[1].Name != "seed-scripts" {
		t.Fatalf("assets = %#v", service.Assets)
	}
	if !containsReason(service.Warnings, "non-.sql files") {
		t.Fatalf("warnings = %#v", service.Warnings)
	}
}

func TestAnalyzeUnsupportedForBuild(t *testing.T) {
	root := t.TempDir()
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  api:
    build: .
    ports:
      - "8080:8080"
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if analysis.Mode != ModeUnsupported || analysis.BrowserNative {
		t.Fatalf("analysis = %#v", analysis)
	}
	if len(analysis.Services) != 1 || len(analysis.Services[0].Unsupported) == 0 {
		t.Fatalf("unsupported reasons missing: %#v", analysis.Services)
	}
}

func TestAnalyzePortRangesDoNotAbort(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    ports:
      - "3000-3005:3000-3005"
    volumes:
      - ./site:/usr/share/nginx/html:ro
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatalf("port range aborted analysis: %v", err)
	}
	if analysis.Mode != ModeBrowserNative || len(analysis.Services) != 1 || !analysis.Services[0].BrowserNative {
		t.Fatalf("analysis = %#v", analysis)
	}
}

func TestParsePortNumberRangesAndJunk(t *testing.T) {
	cases := map[string]int{
		"80":         80,
		"3000-3005":  3000,
		" 8080 ":     8080,
		"":           0,
		"not-a-port": 0,
		"5173/tcp":   0, // protocol is split off before this helper is called
	}
	for input, want := range cases {
		if got := parsePortNumber(input); got != want {
			t.Errorf("parsePortNumber(%q) = %d, want %d", input, got, want)
		}
	}
}

func TestAnalyzeRegistryQualifiedImagesAreRecognized(t *testing.T) {
	for _, image := range []string{"docker.io/library/postgres:16", "library/postgres", "postgres:16"} {
		t.Run(image, func(t *testing.T) {
			root := t.TempDir()
			initDir := filepath.Join(root, "db-init")
			if err := os.Mkdir(initDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(initDir, "01-schema.sql"), []byte("create table demo(id integer);\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			composeFile := filepath.Join(root, "compose.yaml")
			if err := os.WriteFile(composeFile, []byte(`
services:
  db:
    image: `+image+`
    volumes:
      - ./db-init:/docker-entrypoint-initdb.d:ro
`), 0o644); err != nil {
				t.Fatal(err)
			}
			analysis, err := AnalyzeFile(composeFile)
			if err != nil {
				t.Fatal(err)
			}
			service := analysis.Services[0]
			if service.Adapter != AdapterPostgresPGlite || !service.BrowserNative {
				t.Fatalf("image %q: adapter = %q browserNative = %v (want postgres-pglite)", image, service.Adapter, service.BrowserNative)
			}
		})
	}
}

func TestNormalizedImagePreservesPlainNamespace(t *testing.T) {
	// A registry host must be stripped, but a plain Docker Hub namespace must
	// not be, or distinct images would collide.
	if got := normalizedImage("nginxinc/nginx-unprivileged:latest"); got != "nginxinc/nginx-unprivileged" {
		t.Fatalf("normalizedImage stripped a plain namespace: %q", got)
	}
	if got := normalizedImage("ghcr.io/acme/node:20"); got != "acme/node" {
		t.Fatalf("normalizedImage(ghcr.io/acme/node) = %q", got)
	}
}

func TestAnalyzeProfileGatedServicesAreSkipped(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
  debug-cache:
    image: redis:7
    profiles:
      - debug
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(analysis.Services) != 1 || analysis.Services[0].Name != "web" {
		t.Fatalf("profile-gated service was not skipped: %#v", analysis.Services)
	}
	if analysis.Mode != ModeBrowserNative || analysis.Readiness.Status != "ready" || analysis.Readiness.Score != 100 {
		t.Fatalf("readiness = %#v mode = %s", analysis.Readiness, analysis.Mode)
	}
	if !containsReason(analysis.Warnings, "profile-gated") || !containsReason(analysis.Warnings, "debug-cache") {
		t.Fatalf("expected a profile-skip warning, got %#v", analysis.Warnings)
	}
}

func TestAnalyzeExtendsIsUnsupportedWithHonestReason(t *testing.T) {
	root := t.TempDir()
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    extends:
      file: base.yaml
      service: web
`), 0o644); err != nil {
		t.Fatal(err)
	}
	analysis, err := AnalyzeFile(composeFile)
	if err != nil {
		t.Fatal(err)
	}
	service := analysis.Services[0]
	if service.BrowserNative || service.Adapter != AdapterUnsupported {
		t.Fatalf("extends service = %#v", service)
	}
	if !containsReason(service.Unsupported, "extends:") {
		t.Fatalf("expected an explicit extends reason, got %#v", service.Unsupported)
	}
	if len(service.Suggestions) == 0 {
		t.Fatalf("expected a flatten suggestion, got %#v", service.Suggestions)
	}
}

func containsReason(reasons []string, substring string) bool {
	for _, reason := range reasons {
		if strings.Contains(reason, substring) {
			return true
		}
	}
	return false
}
