package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/ramazankara/pocketstack/internal/analyzer"
	"github.com/ramazankara/pocketstack/internal/generator"
)

var version = "dev"

func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stdout)
		return 0
	}
	switch args[0] {
	case "analyze":
		return analyze(args[1:], stdout, stderr)
	case "demo":
		return demo(args[1:], stdout, stderr)
	case "version":
		fmt.Fprintln(stdout, version)
		return 0
	case "-h", "--help", "help":
		usage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n", args[0])
		usage(stderr)
		return 2
	}
}

func analyze(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("analyze", flag.ContinueOnError)
	fs.SetOutput(stderr)
	composeFile := fs.String("f", "", "compose file")
	jsonOutput := fs.Bool("json", false, "print JSON")
	format := fs.String("format", "text", "output format: text, json, markdown")
	profiles := profileFlags(fs)
	safeRoot := fs.String("safe-root", "", "restrict local project files to this directory")
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	if *format != "text" && *format != "json" && *format != "markdown" {
		fmt.Fprintf(stderr, "unknown output format %q; use text, json, or markdown\n", *format)
		return 2
	}
	if *jsonOutput {
		conflict := false
		fs.Visit(func(f *flag.Flag) {
			if f.Name == "format" && *format != "json" {
				conflict = true
			}
		})
		if conflict {
			fmt.Fprintln(stderr, "--json cannot be combined with --format other than json")
			return 2
		}
		*format = "json"
	}
	resolvedCompose, err := resolveComposeFile(*composeFile)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	analysis, err := analyzer.AnalyzeFileWithin(resolvedCompose, *safeRoot, (*profiles)...)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if *format == "json" {
		return printJSON(stdout, stderr, analysis)
	}
	if *format == "markdown" {
		if _, err := io.WriteString(stdout, markdownReport(analysis)); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	fmt.Fprintf(stdout, "Mode: %s\n", analysis.Mode)
	fmt.Fprintf(stdout, "Browser readiness: %d%% (%s)\n", analysis.Readiness.Score, analysis.Readiness.Summary)
	for _, service := range analysis.Services {
		if service.BrowserNative {
			if service.AssetSource != "" {
				fmt.Fprintf(stdout, "  %s: %s adapter from %s\n", service.Name, service.Adapter, service.AssetSource)
			} else {
				fmt.Fprintf(stdout, "  %s: %s adapter\n", service.Name, service.Adapter)
			}
			for _, warning := range service.Warnings {
				fmt.Fprintf(stdout, "    - warning: %s\n", warning)
			}
			continue
		}
		fmt.Fprintf(stdout, "  %s: unsupported in browser-native mode\n", service.Name)
		for _, reason := range service.Unsupported {
			fmt.Fprintf(stdout, "    - %s\n", reason)
		}
		for _, suggestion := range service.Suggestions {
			fmt.Fprintf(stdout, "    suggestion: %s\n", suggestion)
		}
	}
	if len(analysis.Warnings) > 0 {
		fmt.Fprintln(stdout, "\nWarnings:")
		for _, warning := range analysis.Warnings {
			fmt.Fprintf(stdout, "  - %s\n", warning)
		}
	}
	if !analysis.BrowserNative {
		fmt.Fprintln(stdout, "\nNext steps:")
		for _, step := range analysis.NextSteps {
			fmt.Fprintf(stdout, "  - %s\n", step)
		}
	}
	return 0
}

func demo(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("demo", flag.ContinueOnError)
	fs.SetOutput(stderr)
	composeFile := fs.String("f", "", "compose file")
	outputDir := fs.String("o", "pocketstack-demo", "output directory")
	profiles := profileFlags(fs)
	safeRoot := fs.String("safe-root", "", "restrict local project files to this directory")
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	resolvedCompose, err := resolveComposeFile(*composeFile)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	result, err := generator.Generate(generator.Options{
		ComposeFile: resolvedCompose,
		OutputDir:   *outputDir,
		AllowedRoot: *safeRoot,
		Profiles:    *profiles,
	})
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	absOutput, _ := filepath.Abs(result.OutputDir)
	fmt.Fprintf(stdout, "Generated %s demo at %s\n", result.Mode, absOutput)
	return 0
}

func printJSON(stdout, stderr io.Writer, value any) int {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if _, err := fmt.Fprintln(stdout, string(data)); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func profileFlags(fs *flag.FlagSet) *[]string {
	var profiles []string
	fs.Func("profile", "enable a Compose profile (repeatable; * enables all)", func(value string) error {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("profile name must not be empty")
		}
		profiles = append(profiles, value)
		return nil
	})
	return &profiles
}

func resolveComposeFile(path string) (string, error) {
	if path != "" {
		return filepath.Abs(path)
	}
	for _, candidate := range []string{"compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"} {
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Abs(candidate)
		}
	}
	return "", fmt.Errorf("no compose file found; pass -f")
}

func usage(w io.Writer) {
	fmt.Fprintln(w, strings.TrimSpace(`PocketStack turns browser-compatible Docker Compose projects into static demos.

Usage:
  pocketstack analyze [-f compose.yaml] [--json | --format text|json|markdown] [--profile name] [--safe-root directory]
  pocketstack demo [-f compose.yaml] [-o pocketstack-demo] [--profile name] [--safe-root directory]
  pocketstack version`))
}
