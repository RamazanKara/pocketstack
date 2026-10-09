package analyzer

import (
	"strings"
	"testing"
)

func FuzzParseEnvFile(f *testing.F) {
	for _, raw := range []string{"", "A=value\nBARE\n", "export SPACED='  keep  '\r\n# comment\r\n", "=ignored\nA=b=c\nA=last"} {
		f.Add(raw)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		var result ServiceAnalysis
		entries := parseEnvFile(raw, "app.env", &result)
		for _, entry := range entries {
			key, _, ok := strings.Cut(entry, "=")
			if !ok || key == "" || key != strings.TrimSpace(key) {
				t.Fatalf("invalid environment entry %q", entry)
			}
		}
		values := map[string]string{}
		mergeEnvironment(values, entries)
		var previous string
		for _, entry := range sortedEnvironment(values) {
			key, value, _ := strings.Cut(entry, "=")
			if key <= previous || values[key] != value {
				t.Fatalf("environment lost order or value: %q", entry)
			}
			previous = key
		}
	})
}
