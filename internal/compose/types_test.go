package compose

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

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

func TestVolumeSpecYAML(t *testing.T) {
	cases := []struct {
		name, input, source, target, kind string
		readOnly, bind                    bool
	}{
		{"anonymous", `/data`, "", "/data", "", false, false},
		{"named", `data:/data:rw`, "data", "/data", "volume", false, false},
		{"one letter named", `a:/data:ro`, "a", "/data", "volume", true, false},
		{"relative", `./site:/srv:ro,z`, "./site", "/srv", "bind", true, true},
		{"parent", `..:/srv`, "..", "/srv", "bind", false, true},
		{"absolute", `/tmp/site:/srv`, "/tmp/site", "/srv", "bind", false, true},
		{"windows drive", `C:\site:/srv`, `C:\site`, "/srv", "bind", false, true},
		{"windows readonly", `C:\site:/srv:ro`, `C:\site`, "/srv", "bind", true, true},
		{"windows forward slashes", `C:/site:/srv`, "C:/site", "/srv", "bind", false, true},
		{"windows relative", `.\site:/srv`, `.\site`, "/srv", "bind", false, true},
		{"windows parent", `..\site:/srv`, `..\site`, "/srv", "bind", false, true},
		{"unc", `\\server\share:/srv`, `\\server\share`, "/srv", "bind", false, true},
		{"long bind", `{type: bind, source: ./site, target: /srv, read_only: true}`, "./site", "/srv", "bind", true, true},
		{"long named", `{type: volume, source: data, target: /data}`, "data", "/data", "volume", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var volume VolumeSpec
			if err := yaml.Unmarshal([]byte(tc.input), &volume); err != nil {
				t.Fatal(err)
			}
			if volume.Source != tc.source || volume.Target != tc.target || volume.Type != tc.kind || volume.ReadOnly != tc.readOnly || volume.IsBindLike() != tc.bind {
				t.Fatalf("volume = %#v, want source %q, target %q, type %q, readonly %v, bind %v", volume, tc.source, tc.target, tc.kind, tc.readOnly, tc.bind)
			}
		})
	}
}

func TestPortSpecYAML(t *testing.T) {
	cases := []struct {
		input, published, protocol string
		target                     int
	}{
		{"80", "", "tcp", 80},
		{"127.0.0.1:8080:80/UDP", "8080", "udp", 80},
		{"'[::1]:8080:80'", "8080", "tcp", 80},
		{"3000-3005:3000-3005", "3000-3005", "tcp", 3000},
		{"{target: 53, published: 5353, protocol: UDP}", "5353", "udp", 53},
		{"{target: 80, protocol: ''}", "", "tcp", 80},
		{"'${PORT}'", "", "tcp", 0},
	}
	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			var port PortSpec
			if err := yaml.Unmarshal([]byte(tc.input), &port); err != nil {
				t.Fatal(err)
			}
			if port.Target != tc.target || port.Published != tc.published || port.Protocol != tc.protocol {
				t.Fatalf("port = %#v, want target %d, published %q, protocol %q", port, tc.target, tc.published, tc.protocol)
			}
		})
	}
}

func TestServiceValuesYAML(t *testing.T) {
	cases := []struct {
		name, input string
		labels      map[string]string
		env         []string
		files       []EnvFileSpec
	}{
		{
			name:   "maps and optional env file",
			input:  "labels: {pocketstack.adapter: frontend, port: 5173}\nenvironment: {Z: null, A: '  spaced  ', N: 42}\nenv_file: [{path: ' optional.env ', required: false}, required.env]",
			labels: map[string]string{"pocketstack.adapter": "frontend", "port": "5173"},
			env:    []string{"A=  spaced  ", "N=42", "Z="},
			files:  []EnvFileSpec{{Path: "optional.env", Required: false}, {Path: "required.env", Required: true}},
		},
		{
			name:   "lists and scalar env file",
			input:  "labels: ['a=b=c', 'enabled']\nenvironment: ['A=b=c', 'EMPTY', 'SPACED=  x  ']\nenv_file: app.env",
			labels: map[string]string{"a": "b=c", "enabled": "true"},
			env:    []string{"A=b=c", "EMPTY", "SPACED=  x  "},
			files:  []EnvFileSpec{{Path: "app.env", Required: true}},
		},
		{
			name:   "long env file with quoted boolean",
			input:  "env_file: {path: optional.env, required: 'false'}",
			labels: map[string]string{}, env: []string{},
			files: []EnvFileSpec{{Path: "optional.env", Required: false}},
		},
		{name: "empty", input: "{}", labels: map[string]string{}, env: []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var service Service
			if err := yaml.Unmarshal([]byte(tc.input), &service); err != nil {
				t.Fatal(err)
			}
			if got := service.LabelMap(); !reflect.DeepEqual(got, tc.labels) {
				t.Errorf("labels = %#v, want %#v", got, tc.labels)
			}
			if got := service.EnvironmentList(); !reflect.DeepEqual(got, tc.env) {
				t.Errorf("environment = %#v, want %#v", got, tc.env)
			}
			if got := service.EnvFiles(); !reflect.DeepEqual(got, tc.files) {
				t.Errorf("env files = %#v, want %#v", got, tc.files)
			}
		})
	}
}

func TestLoadFile(t *testing.T) {
	for _, tc := range []struct{ name, input, wantError string }{
		{"valid", "services: {web: {image: nginx}}", ""},
		{"empty", "", "has no services"},
		{"no services", "services: {}", "has no services"},
		{"malformed", "services: [", "yaml:"},
		{"port sequence", "services: {web: {ports: [[80]]}}", "unsupported port syntax"},
		{"volume sequence", "services: {web: {volumes: [[/data]]}}", "unsupported volume syntax"},
		{"escaping name", "services: {'../outside': {image: nginx}}", "invalid service name"},
		{"windows escaping name", `services: {'..\outside': {image: nginx}}`, "invalid service name"},
		{"absolute name", "services: {'/outside': {image: nginx}}", "invalid service name"},
		{"dot name", "services: {'.': {image: nginx}}", "invalid service name"},
		{"empty name", "services: {'': {image: nginx}}", "invalid service name"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "compose.yaml")
			if err := os.WriteFile(file, []byte(tc.input), 0o644); err != nil {
				t.Fatal(err)
			}
			project, err := LoadFile(file)
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("error = %v, want %q", err, tc.wantError)
				}
				return
			}
			if err != nil || project.Services["web"].Image != "nginx" {
				t.Fatalf("project = %#v, error = %v", project, err)
			}
		})
	}
	if _, err := LoadFile(filepath.Join(t.TempDir(), "missing.yaml")); !os.IsNotExist(err) {
		t.Fatalf("missing file error = %v", err)
	}
}

func TestResolveVolumeSource(t *testing.T) {
	root := t.TempDir()
	for _, tc := range []struct{ source, want string }{
		{"", ""},
		{"./site", filepath.Join(root, "site")},
		{filepath.Join(root, "site"), filepath.Join(root, "site")},
	} {
		if got := (VolumeSpec{Source: tc.source}).ResolveSource(root); got != tc.want {
			t.Errorf("ResolveSource(%q) = %q, want %q", tc.source, got, tc.want)
		}
	}
}
