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

func TestRunAnalyzeSafeRootRejectsExternalProjectFiles(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	outsideEnv := filepath.Join(outside, "secrets.env")
	if err := os.WriteFile(outsideEnv, []byte("TOKEN=do-not-package\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"dev":"vite"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	composeFile := filepath.Join(root, "compose.yaml")
	compose := "services:\n  app:\n    image: node:22-alpine\n    command: npm run dev\n    env_file: " + outsideEnv + "\n    volumes:\n      - .:/workspace\n"
	if err := os.WriteFile(composeFile, []byte(compose), 0o644); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	code := Run([]string{"analyze", "-f", composeFile, "--safe-root", root}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "outside the allowed project root") {
		t.Fatalf("stderr = %q, want safe-root rejection", stderr.String())
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

func TestRunUsage(t *testing.T) {
	for _, tc := range []struct {
		name    string
		args    []string
		code    int
		message string
	}{
		{"no command", nil, 0, "Usage:"},
		{"help", []string{"--help"}, 0, "Usage:"},
		{"help command", []string{"help"}, 0, "Usage:"},
		{"analyze help", []string{"analyze", "--help"}, 0, "safe-root"},
		{"demo help", []string{"demo", "-h"}, 0, "safe-root"},
		{"analyze bad flag", []string{"analyze", "--missing"}, 2, "flag provided but not defined"},
		{"demo bad flag", []string{"demo", "--missing"}, 2, "flag provided but not defined"},
		{"missing flag value", []string{"demo", "-o"}, 2, "flag needs an argument"},
		{"empty analyze profile", []string{"analyze", "--profile="}, 2, "profile name must not be empty"},
		{"empty demo profile", []string{"demo", "--profile", " "}, 2, "profile name must not be empty"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := Run(tc.args, &stdout, &stderr); code != tc.code {
				t.Fatalf("code = %d, want %d; stderr = %q", code, tc.code, stderr.String())
			}
			if !strings.Contains(stdout.String()+stderr.String(), tc.message) {
				t.Fatalf("stdout = %q, stderr = %q, want %q", stdout.String(), stderr.String(), tc.message)
			}
		})
	}
}

func TestRunProfiles(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "compose.yaml")
	if err := os.WriteFile(file, []byte("services:\n  db:\n    image: postgres:16\n    profiles: [demo, database]\n  cache:\n    image: redis:7\n    profiles: [debug]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                   string
		args                   []string
		count, score, demoCode int
	}{
		{"default", nil, 0, 0, 1},
		{"one profile", []string{"--profile", "demo"}, 1, 100, 0},
		{"second membership", []string{"--profile", "database"}, 1, 100, 0},
		{"repeated", []string{"--profile", "demo", "--profile", "debug"}, 2, 50, 1},
		{"duplicate", []string{"--profile", "demo", "--profile", "demo"}, 1, 100, 0},
		{"all", []string{"--profile", "*"}, 2, 50, 1},
		{"unknown", []string{"--profile", "missing"}, 0, 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			args := append([]string{"analyze", "-f", file, "--json", "--safe-root", root}, tc.args...)
			if code := Run(args, &stdout, &stderr); code != 0 {
				t.Fatalf("analyze code = %d; stderr = %q", code, stderr.String())
			}
			var analysis struct {
				Readiness struct{ Score int }
				Services  []struct{ Name string }
			}
			if err := json.Unmarshal(stdout.Bytes(), &analysis); err != nil {
				t.Fatal(err)
			}
			if len(analysis.Services) != tc.count || analysis.Readiness.Score != tc.score {
				t.Fatalf("analysis = %+v, want count %d and score %d", analysis, tc.count, tc.score)
			}
			output := filepath.Join(t.TempDir(), "demo")
			stdout.Reset()
			stderr.Reset()
			args = append([]string{"demo", "-f", file, "-o", output, "--safe-root", root}, tc.args...)
			if code := Run(args, &stdout, &stderr); code != tc.demoCode {
				t.Fatalf("demo code = %d, want %d; stderr = %q", code, tc.demoCode, stderr.String())
			}
			if tc.demoCode != 0 {
				if _, err := os.Stat(output); !os.IsNotExist(err) {
					t.Fatalf("blocked demo created output: %v", err)
				}
				return
			}
			data, err := os.ReadFile(filepath.Join(output, "pocketstack.manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest struct{ Services []struct{ Name string } }
			if err := json.Unmarshal(data, &manifest); err != nil {
				t.Fatal(err)
			}
			if len(manifest.Services) != 1 || manifest.Services[0].Name != "db" {
				t.Fatalf("wrong generated services: %+v", manifest.Services)
			}
		})
	}
}

func TestRunConfigDiagnostics(t *testing.T) {
	file := filepath.Join(t.TempDir(), "compose.yaml")
	if err := os.WriteFile(file, []byte("services:\n  app:\n    environment: wrong\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, command := range []string{"analyze", "demo"} {
		var stdout, stderr bytes.Buffer
		if code := Run([]string{command, "-f", file}, &stdout, &stderr); code != 1 || stdout.Len() != 0 {
			t.Fatalf("%s: code = %d, stdout = %q", command, code, stdout.String())
		}
		for _, want := range []string{file, "line 3", `service "app"`, "environment must be a mapping"} {
			if !strings.Contains(stderr.String(), want) {
				t.Errorf("%s: stderr = %q, want %q", command, stderr.String(), want)
			}
		}
	}
}

func TestRunComposeDiscovery(t *testing.T) {
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(cwd); err != nil {
			t.Error(err)
		}
	})
	for _, command := range []string{"analyze", "demo"} {
		var stdout, stderr bytes.Buffer
		if code := Run([]string{command}, &stdout, &stderr); code != 1 || !strings.Contains(stderr.String(), "no compose file found") {
			t.Fatalf("%s: code = %d, stderr = %q", command, code, stderr.String())
		}
	}
	names := []string{"docker-compose.yaml", "docker-compose.yml", "compose.yml", "compose.yaml"}
	for _, name := range names {
		if err := os.WriteFile(name, []byte("services: {cache: {image: redis:7}}"), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := resolveComposeFile("")
		if err != nil || got != filepath.Join(root, name) {
			t.Fatalf("file = %q, error = %v, want %s", got, err, name)
		}
	}
	for _, command := range []string{"analyze", "demo"} {
		var stdout, stderr bytes.Buffer
		code := Run([]string{command}, &stdout, &stderr)
		if command == "analyze" {
			if code != 0 || !strings.Contains(stdout.String(), "Next steps:") || !strings.Contains(stdout.String(), "suggestion:") {
				t.Fatalf("analyze: code = %d, stdout = %q", code, stdout.String())
			}
		} else if code != 1 || !strings.Contains(stderr.String(), "unsupported services") {
			t.Fatalf("demo: code = %d, stderr = %q", code, stderr.String())
		}
	}
}
