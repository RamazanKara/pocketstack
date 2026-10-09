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

func TestConfigDiagnostics(t *testing.T) {
	for _, tc := range []struct{ name, input, want string }{
		{"environment scalar", "services:\n  app:\n    environment: BAD\n", "line 3: environment must be a mapping"},
		{"environment nested", "services:\n  app:\n    environment:\n      KEY: [bad]\n", "line 4: environment.KEY must be a scalar"},
		{"environment list map", "services:\n  app:\n    environment:\n      - KEY: bad\n", "line 4: environment entries must be scalar"},
		{"labels scalar", "services:\n  app:\n    labels: wrong\n", "line 3: labels must be a mapping"},
		{"labels nested", "services:\n  app:\n    labels: {key: {nested: bad}}\n", "line 3: labels.key must be a scalar"},
		{"env path missing", "services:\n  app:\n    env_file: {required: false}\n", "line 3: env_file mapping requires a path"},
		{"env path empty", "services:\n  app:\n    env_file: ''\n", "line 3: env_file path must be a non-empty string"},
		{"env path numeric", "services:\n  app:\n    env_file: 42\n", "line 3: env_file path must be a non-empty string"},
		{"env list null", "services:\n  app:\n    env_file: [null]\n", "line 3: env_file path must be a non-empty string"},
		{"env required", "services:\n  app:\n    env_file: {path: app.env, required: maybe}\n", "line 3: env_file.required must be true or false"},
		{"env required numeric", "services:\n  app:\n    env_file: {path: app.env, required: 0}\n", "line 3: env_file.required must be true or false"},
		{"null service", "services:\n  app: null\n", "line 2: service must be a mapping"},
		{"service name", "services:\n  '../bad': {}\n", "line 2: invalid service name"},
		{"typed field", "services:\n  app:\n    profiles: demo\n", "line 3"},
		{"duplicate", "services:\n  app: {}\n  app: {}\n", "line 3"},
		{"port shape", "services:\n  app:\n    ports: [[80]]\n", "unsupported port syntax at line 3"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "compose.yaml")
			if err := os.WriteFile(file, []byte(tc.input), 0o644); err != nil {
				t.Fatal(err)
			}
			_, err := LoadFile(file)
			if err == nil || !strings.Contains(err.Error(), file) || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want filename and %q", err, tc.want)
			}
		})
	}
}

func TestConfigValidationPreservesComposeForms(t *testing.T) {
	for _, input := range []string{
		"services: {app: {image: redis, environment: {A: null, B: false, C: 42}, labels: {enabled: null}}}",
		"services: {app: {environment: [BARE, 'A=b=c'], labels: [enabled, 'key=value']}}",
		"services: {app: {env_file: [{path: optional.env, required: 'false'}, app.env]}}",
		"services: {app: {env_file: {path: optional.env, required: ' false '}}}",
		"services: {app: {env_file: null, environment: null, labels: null, x-custom: {anything: true}}}",
		"x-env: &env {A: value}\nx-service: &base {image: redis, environment: *env}\nservices: {app: {<<: *base}}",
		"x-env: &env {A: value}\nservices: {app: {environment: {<<: *env, B: second}}}",
		"x-service: &base {image: redis}\nservices: {app: *base}",
		"x-services: &services {app: {image: redis}}\nservices: *services",
		"x-path: &path app.env\nservices: {app: {env_file: *path}}",
	} {
		t.Run(input, func(t *testing.T) {
			project, err := parseProject([]byte(input))
			if err != nil || len(project.Services) != 1 {
				t.Fatalf("project = %+v, error = %v", project, err)
			}
		})
	}
}

func FuzzParseProject(f *testing.F) {
	for _, input := range []string{"", "services: {app: {image: nginx}}", "services: {app: {env_file: [{required: false}]}}", "services: {app: {ports: ['80:80'], volumes: ['./site:/srv:ro']}}", "x-base: &base {environment: {A: null}}\nservices: {app: {<<: *base}}", "services: &loop {app: *loop}"} {
		f.Add([]byte(input))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		project, err := parseProject(data)
		if err != nil {
			return
		}
		if len(project.Services) == 0 {
			t.Fatal("accepted project without services")
		}
		for name, service := range project.Services {
			if name == "." || !filepath.IsLocal(name) || strings.ContainsAny(name, `/\`) {
				t.Fatalf("accepted unsafe service name %q", name)
			}
			service.LabelMap()
			service.EnvironmentList()
			for _, file := range service.EnvFiles() {
				if strings.TrimSpace(file.Path) == "" {
					t.Fatal("accepted empty env_file path")
				}
			}
		}
	})
}

func FuzzPortSpec(f *testing.F) {
	for _, input := range []string{"80", "'[::1]:8080:80/UDP'", "3000-3005:3000-3005", "{target: 53, protocol: udp}", "[[80]]", "'${PORT}'"} {
		f.Add([]byte(input))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		var port PortSpec
		if err := yaml.Unmarshal(data, &port); err == nil && port.Protocol != strings.ToLower(port.Protocol) {
			t.Fatalf("protocol was not normalized: %q", port.Protocol)
		}
	})
}

func FuzzVolumeSpec(f *testing.F) {
	for _, input := range []string{"./site:/srv:ro,z", `C:\site:/srv:ro`, "/data", "{type: bind, source: ./site, target: /srv}", "[[/data]]"} {
		f.Add([]byte(input))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		var volume VolumeSpec
		if err := yaml.Unmarshal(data, &volume); err != nil {
			return
		}
		resolved := volume.ResolveSource("project")
		if volume.Source == "" && resolved != "" {
			t.Fatalf("anonymous volume resolved to %q", resolved)
		}
	})
}
