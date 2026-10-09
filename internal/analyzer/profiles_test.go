package analyzer

import (
	"reflect"
	"strings"
	"testing"

	"github.com/ramazankara/pocketstack/internal/compose"
)

func TestAnalyzeProfiles(t *testing.T) {
	project := &compose.Project{Services: map[string]compose.Service{
		"base":  {Image: "postgres:16"},
		"db":    {Image: "postgres:16", Profiles: []string{"demo", "database"}},
		"cache": {Image: "redis:7", Profiles: []string{"debug"}},
	}}
	for _, tc := range []struct {
		name            string
		profiles, names []string
		ready           bool
		warning         string
	}{
		{"default", nil, []string{"base"}, true, "not started by default: cache, db"},
		{"one", []string{"demo"}, []string{"base", "db"}, true, "not enabled by the selected profiles: cache"},
		{"alternate", []string{"database"}, []string{"base", "db"}, true, "not enabled by the selected profiles: cache"},
		{"multiple", []string{"demo", "debug"}, []string{"base", "cache", "db"}, false, ""},
		{"wildcard", []string{"*"}, []string{"base", "cache", "db"}, false, ""},
		{"duplicate", []string{"demo", "demo"}, []string{"base", "db"}, true, "not enabled by the selected profiles: cache"},
		{"unknown", []string{"missing"}, []string{"base"}, true, "not enabled by the selected profiles: cache, db"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			analysis := Analyze(project, t.TempDir(), "compose.yaml", tc.profiles...)
			names := make([]string, 0, len(analysis.Services))
			for _, service := range analysis.Services {
				names = append(names, service.Name)
			}
			if !reflect.DeepEqual(names, tc.names) || analysis.BrowserNative != tc.ready {
				t.Fatalf("names = %v, ready = %v; want %v, %v", names, analysis.BrowserNative, tc.names, tc.ready)
			}
			warnings := strings.Join(analysis.Warnings, "\n")
			if tc.warning != "" && !strings.Contains(warnings, tc.warning) {
				t.Fatalf("warnings = %q, want %q", warnings, tc.warning)
			}
			if tc.warning == "" && strings.Contains(warnings, "profile-gated") {
				t.Fatalf("unexpected profile warning: %q", warnings)
			}
		})
	}
}
