package compose

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Project struct {
	Name     string             `yaml:"name,omitempty" json:"name,omitempty"`
	Services map[string]Service `yaml:"services" json:"services"`
	Volumes  map[string]any     `yaml:"volumes,omitempty" json:"volumes,omitempty"`
	Networks map[string]any     `yaml:"networks,omitempty" json:"networks,omitempty"`
}

type Service struct {
	Image       string       `yaml:"image,omitempty" json:"image,omitempty"`
	Build       any          `yaml:"build,omitempty" json:"build,omitempty"`
	Command     any          `yaml:"command,omitempty" json:"command,omitempty"`
	Entrypoint  any          `yaml:"entrypoint,omitempty" json:"entrypoint,omitempty"`
	Ports       []PortSpec   `yaml:"ports,omitempty" json:"ports,omitempty"`
	Expose      []PortSpec   `yaml:"expose,omitempty" json:"expose,omitempty"`
	Volumes     []VolumeSpec `yaml:"volumes,omitempty" json:"volumes,omitempty"`
	DependsOn   any          `yaml:"depends_on,omitempty" json:"dependsOn,omitempty"`
	Extends     any          `yaml:"extends,omitempty" json:"extends,omitempty"`
	Profiles    []string     `yaml:"profiles,omitempty" json:"profiles,omitempty"`
	WorkingDir  string       `yaml:"working_dir,omitempty" json:"workingDir,omitempty"`
	Environment any          `yaml:"environment,omitempty" json:"environment,omitempty"`
	EnvFile     any          `yaml:"env_file,omitempty" json:"envFile,omitempty"`
	Healthcheck any          `yaml:"healthcheck,omitempty" json:"healthcheck,omitempty"`
	Labels      any          `yaml:"labels,omitempty" json:"labels,omitempty"`
}

type EnvFileSpec struct {
	Path     string
	Required bool
}

func (s Service) LabelMap() map[string]string {
	labels := map[string]string{}
	switch typed := s.Labels.(type) {
	case map[string]any:
		for key, value := range typed {
			labels[key] = fmt.Sprint(value)
		}
	case map[any]any:
		for key, value := range typed {
			labels[fmt.Sprint(key)] = fmt.Sprint(value)
		}
	case []any:
		for _, item := range typed {
			key, value, ok := strings.Cut(fmt.Sprint(item), "=")
			if !ok {
				labels[fmt.Sprint(item)] = "true"
				continue
			}
			labels[key] = value
		}
	case []string:
		for _, item := range typed {
			key, value, ok := strings.Cut(item, "=")
			if !ok {
				labels[item] = "true"
				continue
			}
			labels[key] = value
		}
	}
	return labels
}

func (s Service) EnvironmentList() []string {
	values := []string{}
	switch typed := s.Environment.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			values = append(values, fmt.Sprintf("%s=%v", key, typed[key]))
		}
	case map[any]any:
		valuesByKey := map[string]string{}
		keys := make([]string, 0, len(typed))
		for key, value := range typed {
			keyString := fmt.Sprint(key)
			keys = append(keys, keyString)
			valuesByKey[keyString] = fmt.Sprint(value)
		}
		sort.Strings(keys)
		for _, key := range keys {
			values = append(values, fmt.Sprintf("%s=%s", key, valuesByKey[key]))
		}
	case []any:
		for _, item := range typed {
			values = append(values, fmt.Sprint(item))
		}
	case []string:
		values = append(values, typed...)
	}
	return values
}

func (s Service) EnvFiles() []EnvFileSpec {
	switch typed := s.EnvFile.(type) {
	case string:
		return compactEnvFileSpecs([]EnvFileSpec{{Path: typed, Required: true}})
	case []string:
		values := make([]EnvFileSpec, 0, len(typed))
		for _, path := range typed {
			values = append(values, EnvFileSpec{Path: path, Required: true})
		}
		return compactEnvFileSpecs(values)
	case []any:
		values := []EnvFileSpec{}
		for _, item := range typed {
			values = append(values, envFileSpec(item))
		}
		return compactEnvFileSpecs(values)
	case map[string]any:
		return compactEnvFileSpecs([]EnvFileSpec{envFileSpec(typed)})
	case map[any]any:
		return compactEnvFileSpecs([]EnvFileSpec{envFileSpec(typed)})
	default:
		return nil
	}
}

func envFileSpec(value any) EnvFileSpec {
	switch typed := value.(type) {
	case string:
		return EnvFileSpec{Path: typed, Required: true}
	case map[string]any:
		return EnvFileSpec{
			Path:     fmt.Sprint(typed["path"]),
			Required: boolDefault(typed["required"], true),
		}
	case map[any]any:
		return EnvFileSpec{
			Path:     fmt.Sprint(typed["path"]),
			Required: boolDefault(typed["required"], true),
		}
	default:
		return EnvFileSpec{Path: fmt.Sprint(typed), Required: true}
	}
}

func boolDefault(value any, fallback bool) bool {
	switch typed := value.(type) {
	case nil:
		return fallback
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func compactEnvFileSpecs(values []EnvFileSpec) []EnvFileSpec {
	result := []EnvFileSpec{}
	for _, value := range values {
		value.Path = strings.TrimSpace(value.Path)
		if value.Path != "" {
			result = append(result, value)
		}
	}
	return result
}

type PortSpec struct {
	Raw       string `json:"raw,omitempty"`
	Target    int    `json:"target,omitempty"`
	Published string `json:"published,omitempty"`
	Protocol  string `json:"protocol,omitempty"`
}

func (p *PortSpec) UnmarshalYAML(node *yaml.Node) error {
	p.Protocol = "tcp"
	switch node.Kind {
	case yaml.ScalarNode:
		return p.parseScalar(node.Value)
	case yaml.MappingNode:
		for i := 0; i < len(node.Content); i += 2 {
			key := node.Content[i].Value
			value := node.Content[i+1].Value
			switch key {
			case "target":
				p.Target = parsePortNumber(value)
			case "published":
				p.Published = value
			case "protocol":
				if value != "" {
					p.Protocol = strings.ToLower(value)
				}
			}
		}
		p.Raw = node.Value
		return nil
	default:
		return fmt.Errorf("unsupported port syntax at line %d", node.Line)
	}
}

func (p *PortSpec) parseScalar(raw string) error {
	p.Raw = raw
	p.Protocol = "tcp"
	portPart := raw
	if before, after, ok := strings.Cut(raw, "/"); ok {
		portPart = before
		if after != "" {
			p.Protocol = strings.ToLower(after)
		}
	}
	segments := strings.Split(portPart, ":")
	p.Target = parsePortNumber(segments[len(segments)-1])
	if len(segments) >= 2 {
		p.Published = segments[len(segments)-2]
	}
	return nil
}

// parsePortNumber extracts a single port number from a Compose port token. It
// tolerates ranges ("3000-3005" -> 3000) and non-numeric or empty values
// (-> 0) so a single unusual port mapping never aborts analysis of the whole
// project.
func parsePortNumber(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if before, _, ok := strings.Cut(value, "-"); ok {
		value = strings.TrimSpace(before)
	}
	port, err := strconv.Atoi(value)
	if err != nil {
		return 0
	}
	return port
}

type VolumeSpec struct {
	Raw      string `json:"raw,omitempty"`
	Type     string `json:"type,omitempty"`
	Source   string `json:"source,omitempty"`
	Target   string `json:"target,omitempty"`
	ReadOnly bool   `json:"readOnly,omitempty"`
}

func (v *VolumeSpec) UnmarshalYAML(node *yaml.Node) error {
	switch node.Kind {
	case yaml.ScalarNode:
		v.Raw = node.Value
		v.parseScalar(node.Value)
		return nil
	case yaml.MappingNode:
		for i := 0; i < len(node.Content); i += 2 {
			key := node.Content[i].Value
			value := node.Content[i+1].Value
			switch key {
			case "type":
				v.Type = value
			case "source":
				v.Source = value
			case "target":
				v.Target = value
			case "read_only":
				readOnly, _ := strconv.ParseBool(value)
				v.ReadOnly = readOnly
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported volume syntax at line %d", node.Line)
	}
}

func (v *VolumeSpec) parseScalar(raw string) {
	parts := strings.Split(raw, ":")
	switch len(parts) {
	case 1:
		v.Target = parts[0]
	case 2:
		v.Source = parts[0]
		v.Target = parts[1]
	default:
		v.Source = strings.Join(parts[:len(parts)-2], ":")
		v.Target = parts[len(parts)-2]
		v.ReadOnly = strings.Contains(parts[len(parts)-1], "ro")
	}
	if isBindSource(v.Source) {
		v.Type = "bind"
	} else if v.Source != "" {
		v.Type = "volume"
	}
}

func (v VolumeSpec) IsBindLike() bool {
	return v.Type == "bind" || isBindSource(v.Source)
}

func (v VolumeSpec) ResolveSource(projectRoot string) string {
	if v.Source == "" {
		return ""
	}
	if filepath.IsAbs(v.Source) {
		return filepath.Clean(v.Source)
	}
	return filepath.Clean(filepath.Join(projectRoot, v.Source))
}

func isBindSource(source string) bool {
	return source == "." ||
		strings.HasPrefix(source, "./") ||
		strings.HasPrefix(source, "../") ||
		strings.HasPrefix(source, "/") ||
		strings.HasPrefix(source, "~/")
}

func LoadFile(path string) (*Project, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var project Project
	if err := yaml.Unmarshal(data, &project); err != nil {
		return nil, err
	}
	if len(project.Services) == 0 {
		return nil, fmt.Errorf("compose file %s has no services", path)
	}
	return &project, nil
}
