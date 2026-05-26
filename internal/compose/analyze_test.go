package compose

import (
	"os"
	"path/filepath"
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
