package cli

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/ramazankara/pocketstack/internal/analyzer"
)

func markdownReport(analysis *analyzer.Analysis) string {
	var out strings.Builder
	fmt.Fprintln(&out, "# PocketStack compatibility report")
	fmt.Fprintf(&out, "\nMode: %s\n\nBrowser readiness: %d%% (%s)\n", markdownText(analysis.Mode), analysis.Readiness.Score, markdownText(analysis.Readiness.Summary))
	for _, service := range analysis.Services {
		fmt.Fprintf(&out, "\n## %s\n\n", markdownText(service.Name))
		if service.BrowserNative {
			fmt.Fprintf(&out, "Browser-native adapter: %s\n", markdownText(service.Adapter))
		} else {
			fmt.Fprintln(&out, "Unsupported in browser-native mode.")
		}
		if service.Image != "" {
			fmt.Fprintf(&out, "\nImage: %s\n", markdownText(service.Image))
		}
		if service.AssetSource != "" {
			fmt.Fprintf(&out, "\nAsset source: %s\n", markdownText(service.AssetSource))
		}
		if len(service.Unsupported)+len(service.Suggestions)+len(service.Warnings) > 0 {
			fmt.Fprintln(&out)
		}
		for _, reason := range service.Unsupported {
			fmt.Fprintf(&out, "- Blocker: %s\n", markdownText(reason))
		}
		for _, suggestion := range service.Suggestions {
			fmt.Fprintf(&out, "- Suggestion: %s\n", markdownText(suggestion))
		}
		for _, warning := range service.Warnings {
			fmt.Fprintf(&out, "- Warning: %s\n", markdownText(warning))
		}
	}
	if len(analysis.Warnings) > 0 {
		fmt.Fprint(&out, "\n## Warnings\n\n")
		for _, warning := range analysis.Warnings {
			fmt.Fprintf(&out, "- %s\n", markdownText(warning))
		}
	}
	if len(analysis.NextSteps) > 0 {
		fmt.Fprint(&out, "\n## Next steps\n\n")
		for _, step := range analysis.NextSteps {
			fmt.Fprintf(&out, "- %s\n", markdownText(step))
		}
	}
	return out.String()
}

func markdownText(value string) string {
	var out strings.Builder
	for _, r := range value {
		switch {
		case unicode.IsControl(r) || r == '\u2028' || r == '\u2029':
			out.WriteByte(' ')
		case strings.ContainsRune("\\`*_{}[]()#+-.!|<>&~@", r):
			fmt.Fprintf(&out, "&#%d;", r)
		default:
			out.WriteRune(r)
		}
	}
	return out.String()
}
