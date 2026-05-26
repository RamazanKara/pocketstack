package staticdemo

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
