package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeStaticProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("<h1>hi</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(composeFile, []byte(`
services:
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro
  debugtool:
    image: redis:7
    profiles:
      - debug
`), 0o644); err != nil {
		t.Fatal(err)
	}
	return composeFile
}

func TestRunAnalyzeHumanOutputSurfacesProfileWarning(t *testing.T) {
	composeFile := writeStaticProject(t)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"analyze", "-f", composeFile}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	out := stdout.String()
	for _, want := range []string{"Browser readiness: 100%", "web: static-web adapter", "Warnings:", "profile-gated"} {
		if !strings.Contains(out, want) {
			t.Fatalf("analyze output missing %q:\n%s", want, out)
		}
	}
	// The service is named in the skip warning, but must not appear as an
	// analyzed service line ("  debugtool: ...").
	if strings.Contains(out, "  debugtool:") {
		t.Fatalf("profile-gated service should not be listed as analyzed:\n%s", out)
	}
}

func TestRunAnalyzeJSONIsValid(t *testing.T) {
	composeFile := writeStaticProject(t)
	var stdout, stderr bytes.Buffer
	code := Run([]string{"analyze", "-f", composeFile, "--json"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	var payload struct {
		Mode      string `json:"mode"`
		Readiness struct {
			Score int `json:"score"`
		} `json:"readiness"`
		Warnings []string `json:"warnings"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		t.Fatalf("analyze --json did not produce valid JSON: %v\n%s", err, stdout.String())
	}
	if payload.Mode != "browser-native" || payload.Readiness.Score != 100 {
		t.Fatalf("unexpected analysis payload: %+v", payload)
	}
	if len(payload.Warnings) == 0 {
		t.Fatalf("expected a profile-skip warning in JSON output")
	}
}

func TestRunAnalyzeMissingFileFails(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := Run([]string{"analyze", "-f", filepath.Join(t.TempDir(), "nope.yaml")}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if stderr.Len() == 0 {
		t.Fatalf("expected an error message on stderr")
	}
}

func TestRunDemoGeneratesOutput(t *testing.T) {
	composeFile := writeStaticProject(t)
	outDir := filepath.Join(t.TempDir(), "demo")
	var stdout, stderr bytes.Buffer
	code := Run([]string{"demo", "-f", composeFile, "-o", outDir}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	if _, err := os.Stat(filepath.Join(outDir, "pocketstack.manifest.json")); err != nil {
		t.Fatalf("demo did not write a manifest: %v", err)
	}
}

func TestRunVersionAndUnknownCommand(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := Run([]string{"version"}, &stdout, &stderr); code != 0 {
		t.Fatalf("version exit code = %d", code)
	}
	if strings.TrimSpace(stdout.String()) == "" {
		t.Fatalf("version produced no output")
	}

	stdout.Reset()
	stderr.Reset()
	if code := Run([]string{"frobnicate"}, &stdout, &stderr); code != 2 {
		t.Fatalf("unknown command exit code = %d, want 2", code)
	}
}
