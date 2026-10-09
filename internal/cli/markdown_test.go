package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"github.com/ramazankara/pocketstack/internal/analyzer"
)

func TestRunAnalyzeFormats(t *testing.T) {
	file := writeStaticProject(t)
	for _, tc := range []struct {
		name string
		args []string
		code int
		want string
	}{
		{"default", nil, 0, "Mode: browser-native"},
		{"text", []string{"--format", "text"}, 0, "Mode: browser-native"},
		{"json", []string{"--format", "json"}, 0, `"browserNative": true`},
		{"legacy json", []string{"--json"}, 0, `"browserNative": true`},
		{"json aliases together", []string{"--format", "json", "--json"}, 0, `"browserNative": true`},
		{"markdown", []string{"--format", "markdown"}, 0, "# PocketStack compatibility report"},
		{"unknown", []string{"--format", "xml"}, 2, "unknown output format"},
		{"empty", []string{"--format="}, 2, "unknown output format"},
		{"conflict", []string{"--json", "--format", "markdown"}, 2, "--json cannot be combined"},
		{"reverse conflict", []string{"--format", "text", "--json"}, 2, "--json cannot be combined"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			args := append([]string{"analyze", "-f", file}, tc.args...)
			if code := Run(args, &stdout, &stderr); code != tc.code {
				t.Fatalf("code = %d, want %d; stderr = %q", code, tc.code, stderr.String())
			}
			if !strings.Contains(stdout.String()+stderr.String(), tc.want) {
				t.Fatalf("stdout = %q, stderr = %q, want %q", stdout.String(), stderr.String(), tc.want)
			}
			if tc.code != 0 && stdout.Len() != 0 {
				t.Fatalf("usage error wrote a report: %q", stdout.String())
			}
			if strings.Contains(tc.name, "json") && tc.code == 0 && !json.Valid(stdout.Bytes()) {
				t.Fatalf("invalid JSON: %q", stdout.String())
			}
		})
	}
}

func TestMarkdownReport(t *testing.T) {
	for _, tc := range []struct {
		name     string
		analysis analyzer.Analysis
		want     []string
	}{
		{
			name: "ready",
			analysis: analyzer.Analysis{
				Mode:      analyzer.ModeBrowserNative,
				Readiness: analyzer.Readiness{Score: 100, Summary: "all services are browser-native"},
				Services:  []analyzer.ServiceAnalysis{{Name: "web", BrowserNative: true, Adapter: "static-web", Image: "nginx", AssetSource: "site", Warnings: []string{"custom config ignored"}}},
				Warnings:  []string{"COOP/COEP required"},
				NextSteps: []string{"Generate the demo"},
			},
			want: []string{"Browser readiness: 100%", "## web", "Browser-native adapter: static&#45;web", "Image: nginx", "Asset source: site", "- Warning: custom config ignored", "## Warnings\n\n- COOP/COEP required", "## Next steps\n\n- Generate the demo"},
		},
		{
			name: "blocked",
			analysis: analyzer.Analysis{
				Mode:      analyzer.ModeUnsupported,
				Readiness: analyzer.Readiness{Summary: "no services are browser-native"},
				Services:  []analyzer.ServiceAnalysis{{Name: "cache", Unsupported: []string{"no adapter"}, Suggestions: []string{"Use fixtures"}}},
			},
			want: []string{"Browser readiness: 0%", "## cache", "Unsupported in browser-native mode.", "- Blocker: no adapter", "- Suggestion: Use fixtures"},
		},
		{
			name:     "empty",
			analysis: analyzer.Analysis{Mode: analyzer.ModeUnsupported, Readiness: analyzer.Readiness{Summary: "no active services"}},
			want:     []string{"Mode: unsupported", "Browser readiness: 0% (no active services)"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := markdownReport(&tc.analysis)
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q in report:\n%s", want, got)
				}
			}
		})
	}
}

func TestMarkdownText(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"normal text", "normal text"},
		{"<script>&amp;", "&#60;script&#62;&#38;amp;"},
		{"[click](javascript:alert)", "&#91;click&#93;&#40;javascript:alert&#41;"},
		{"a\r\n# title\t\u2028\u2029", "a  &#35; title   "},
		{"a|b_*`\\", "a&#124;b&#95;&#42;&#96;&#92;"},
		{"café 世界", "café 世界"},
		{"@team", "&#64;team"},
	} {
		if got := markdownText(tc.input); got != tc.want {
			t.Errorf("markdownText(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestMarkdownReportEscapesProjectText(t *testing.T) {
	value := "<img src=x>\n# heading [link](javascript:x) @team"
	analysis := &analyzer.Analysis{
		Services: []analyzer.ServiceAnalysis{{Name: value, Image: value, AssetSource: value, Unsupported: []string{value}, Suggestions: []string{value}, Warnings: []string{value}}},
		Warnings: []string{value}, NextSteps: []string{value},
	}
	got := markdownReport(analysis)
	if strings.Contains(got, "<img") || strings.Count(got, markdownText(value)) != 8 {
		t.Fatalf("unescaped project text in report:\n%s", got)
	}
}

func TestReportWriteFailure(t *testing.T) {
	for _, format := range []string{"markdown", "json"} {
		t.Run(format, func(t *testing.T) {
			var stderr bytes.Buffer
			reader, writer := io.Pipe()
			reader.Close()
			defer writer.Close()
			if code := Run([]string{"analyze", "-f", writeStaticProject(t), "--format", format}, writer, &stderr); code != 1 {
				t.Fatalf("code = %d; stderr = %q", code, stderr.String())
			}
			if !strings.Contains(stderr.String(), io.ErrClosedPipe.Error()) {
				t.Fatalf("stderr = %q, want write error", stderr.String())
			}
		})
	}
}
