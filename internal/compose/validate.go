package compose

import (
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

func parseProject(data []byte) (*Project, error) {
	var document yaml.Node
	if err := yaml.Unmarshal(data, &document); err != nil {
		return nil, err
	}
	var project Project
	if err := document.Decode(&project); err != nil {
		return nil, err
	}
	if len(project.Services) == 0 {
		return nil, fmt.Errorf("line 1: compose file has no services; add a services mapping")
	}
	var source struct {
		Services map[string]yaml.Node `yaml:"services"`
	}
	if err := document.Decode(&source); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(project.Services))
	for name := range project.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		node := source.Services[name]
		if name == "." || !filepath.IsLocal(name) || strings.ContainsAny(name, `/\`) {
			return nil, fmt.Errorf("line %d: invalid service name %q: must be a single local path component", node.Line, name)
		}
		if err := validateService(node); err != nil {
			return nil, fmt.Errorf("service %q: %w", name, err)
		}
	}
	return &project, nil
}

func validateService(node yaml.Node) error {
	node = yamlValue(node)
	if node.Kind != yaml.MappingNode {
		return fmt.Errorf("line %d: service must be a mapping", node.Line)
	}
	var fields map[string]yaml.Node
	if err := node.Decode(&fields); err != nil {
		return err
	}
	for _, name := range []string{"environment", "labels"} {
		field, ok := fields[name]
		if !ok {
			continue
		}
		field = yamlValue(field)
		if field.Tag == "!!null" {
			continue
		}
		switch field.Kind {
		case yaml.MappingNode:
			var values map[string]yaml.Node
			if err := field.Decode(&values); err != nil {
				return err
			}
			keys := make([]string, 0, len(values))
			for key := range values {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				value := yamlValue(values[key])
				if value.Kind != yaml.ScalarNode {
					return fmt.Errorf("line %d: %s.%s must be a scalar value", value.Line, name, key)
				}
			}
		case yaml.SequenceNode:
			for _, item := range field.Content {
				value := yamlValue(*item)
				if value.Kind != yaml.ScalarNode || value.Tag == "!!null" {
					return fmt.Errorf("line %d: %s entries must be scalar KEY=value strings", value.Line, name)
				}
			}
		default:
			return fmt.Errorf("line %d: %s must be a mapping or a list of KEY=value strings", field.Line, name)
		}
	}
	if field, ok := fields["env_file"]; ok {
		field = yamlValue(field)
		if field.Tag == "!!null" {
			return nil
		}
		if field.Kind == yaml.SequenceNode {
			for _, item := range field.Content {
				if err := validateEnvFile(*item); err != nil {
					return err
				}
			}
		} else {
			return validateEnvFile(field)
		}
	}
	return nil
}

func validateEnvFile(node yaml.Node) error {
	node = yamlValue(node)
	path := node
	if node.Kind == yaml.MappingNode {
		var fields map[string]yaml.Node
		if err := node.Decode(&fields); err != nil {
			return err
		}
		var ok bool
		path, ok = fields["path"]
		if !ok {
			return fmt.Errorf("line %d: env_file mapping requires a path", node.Line)
		}
		path = yamlValue(path)
		if required, ok := fields["required"]; ok {
			required = yamlValue(required)
			if required.Tag != "!!null" {
				if _, err := strconv.ParseBool(strings.TrimSpace(required.Value)); err != nil || (required.Tag != "!!bool" && required.Tag != "!!str") {
					return fmt.Errorf("line %d: env_file.required must be true or false", required.Line)
				}
			}
		}
	}
	if path.Kind != yaml.ScalarNode || path.Tag != "!!str" || strings.TrimSpace(path.Value) == "" {
		return fmt.Errorf("line %d: env_file path must be a non-empty string", path.Line)
	}
	return nil
}

func yamlValue(node yaml.Node) yaml.Node {
	if node.Kind == yaml.AliasNode {
		return *node.Alias
	}
	return node
}
