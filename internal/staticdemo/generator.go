package staticdemo

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ramazankara/pocketstack/internal/compose"
)

//go:embed runtime/*
var runtimeFS embed.FS

type Options struct {
	ComposeFile string
	OutputDir   string
	GeneratedAt time.Time
}

type Result struct {
	OutputDir string
	Mode      string
	Manifest  Manifest
}

type Manifest struct {
	Version          string                   `json:"version"`
	GeneratedAt      string                   `json:"generatedAt"`
	Mode             string                   `json:"mode"`
	BrowserOnly      bool                     `json:"browserOnly"`
	ComposeFile      string                   `json:"composeFile"`
	StorageNamespace string                   `json:"storageNamespace"`
	Readiness        compose.Readiness        `json:"readiness"`
	HostRequirements compose.HostRequirements `json:"hostRequirements,omitempty"`
	Warnings         []string                 `json:"warnings,omitempty"`
	NextSteps        []string                 `json:"nextSteps,omitempty"`
	Services         []ManifestService        `json:"services"`
}

type ManifestService struct {
	Name             string                   `json:"name"`
	Image            string                   `json:"image,omitempty"`
	Adapter          string                   `json:"adapter"`
	BrowserNative    bool                     `json:"browserNative"`
	PublicPort       int                      `json:"publicPort,omitempty"`
	BrowserPath      string                   `json:"browserPath,omitempty"`
	Assets           []ManifestAsset          `json:"assets,omitempty"`
	Config           map[string]string        `json:"config,omitempty"`
	Warnings         []string                 `json:"warnings,omitempty"`
	HostRequirements compose.HostRequirements `json:"hostRequirements,omitempty"`
}

type ManifestAsset struct {
	Name   string   `json:"name"`
	Kind   string   `json:"kind"`
	Path   string   `json:"path"`
	Files  []string `json:"files,omitempty"`
	Target string   `json:"target,omitempty"`
}

func Generate(options Options) (*Result, error) {
	if options.GeneratedAt.IsZero() {
		options.GeneratedAt = time.Now().UTC()
	}
	analysis, err := compose.AnalyzeFile(options.ComposeFile)
	if err != nil {
		return nil, err
	}
	if !analysis.BrowserNative {
		return nil, unsupportedError(analysis)
	}

	if err := os.MkdirAll(options.OutputDir, 0o755); err != nil {
		return nil, err
	}
	assetsDir := filepath.Join(options.OutputDir, "assets")
	if err := os.RemoveAll(assetsDir); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		return nil, err
	}

	manifest := Manifest{
		Version:          "2",
		GeneratedAt:      options.GeneratedAt.Format(time.RFC3339),
		Mode:             analysis.Mode,
		BrowserOnly:      true,
		ComposeFile:      analysis.ComposeFile,
		StorageNamespace: demoStorageNamespace(analysis.ComposeFile),
		Readiness:        analysis.Readiness,
		HostRequirements: analysis.HostRequirements,
		Warnings:         analysis.Warnings,
		NextSteps:        analysis.NextSteps,
		Services:         make([]ManifestService, 0, len(analysis.Services)),
	}

	for _, service := range analysis.Services {
		manifestService, err := copyServiceAssets(assetsDir, service, manifest.StorageNamespace)
		if err != nil {
			return nil, err
		}
		manifest.Services = append(manifest.Services, manifestService)
	}

	if err := writeJSON(filepath.Join(options.OutputDir, "pocketstack.manifest.json"), manifest); err != nil {
		return nil, err
	}
	if err := writeIndex(filepath.Join(options.OutputDir, "index.html"), manifest); err != nil {
		return nil, err
	}
	if err := writeRuntime(options.OutputDir); err != nil {
		return nil, err
	}
	if err := writeHostConfigs(options.OutputDir, manifest.HostRequirements); err != nil {
		return nil, err
	}

	return &Result{OutputDir: options.OutputDir, Mode: analysis.Mode, Manifest: manifest}, nil
}

func copyServiceAssets(assetsDir string, service compose.ServiceAnalysis, storageNamespace string) (ManifestService, error) {
	serviceDir := filepath.Join(assetsDir, service.Name)
	manifestService := ManifestService{
		Name:             service.Name,
		Image:            service.Image,
		Adapter:          service.Adapter,
		BrowserNative:    service.BrowserNative,
		PublicPort:       service.PublicPort,
		Config:           cloneMap(service.Config),
		Warnings:         service.Warnings,
		HostRequirements: service.HostRequirements,
	}
	if service.Adapter == compose.AdapterPostgresPGlite || service.Adapter == compose.AdapterSQLite {
		manifestService.Config["storageNamespace"] = storageNamespace
	}
	for _, asset := range service.Assets {
		targetRel := filepath.ToSlash(filepath.Join("assets", service.Name, asset.Target))
		targetAbs := filepath.Join(serviceDir, filepath.FromSlash(asset.Target))
		manifestAsset := ManifestAsset{
			Name:   asset.Name,
			Kind:   asset.Kind,
			Path:   targetRel,
			Target: asset.Target,
		}
		switch asset.Kind {
		case "directory":
			files, err := copyDirectoryAsset(asset, targetAbs)
			if err != nil {
				return manifestService, fmt.Errorf("copy %s assets for %s: %w", asset.Name, service.Name, err)
			}
			manifestAsset.Files = files
		case "sql-directory":
			files, err := copyTreeFiltered(asset.Source, targetAbs, func(rel string, entry os.DirEntry) bool {
				return strings.EqualFold(filepath.Ext(rel), ".sql")
			})
			if err != nil {
				return manifestService, fmt.Errorf("copy %s assets for %s: %w", asset.Name, service.Name, err)
			}
			manifestAsset.Files = files
		case "json-directory":
			files, err := copyTreeFiltered(asset.Source, targetAbs, func(rel string, entry os.DirEntry) bool {
				return strings.EqualFold(filepath.Ext(rel), ".json")
			})
			if err != nil {
				return manifestService, fmt.Errorf("copy %s assets for %s: %w", asset.Name, service.Name, err)
			}
			manifestAsset.Files = files
		case "file":
			if asset.Name == "static" {
				if err := copyStaticFile(asset.Source, targetAbs, staticAssetRel(asset.Target)); err != nil {
					return manifestService, fmt.Errorf("copy %s asset for %s: %w", asset.Name, service.Name, err)
				}
				break
			}
			if err := copyFile(asset.Source, targetAbs); err != nil {
				return manifestService, fmt.Errorf("copy %s asset for %s: %w", asset.Name, service.Name, err)
			}
		default:
			return manifestService, fmt.Errorf("unknown asset kind %q for service %s", asset.Kind, service.Name)
		}
		manifestService.Assets = append(manifestService.Assets, manifestAsset)
		switch asset.Name {
		case "static":
			indexPath := filepath.ToSlash(filepath.Join(targetRel, "index.html"))
			if _, err := os.Stat(filepath.Join(targetAbs, "index.html")); err == nil {
				manifestService.BrowserPath = indexPath
			} else {
				manifestService.BrowserPath = targetRel
			}
		case "project":
			manifestService.Config["projectPath"] = targetRel
		case "module":
			manifestService.Config["modulePath"] = targetRel
		case "openapi":
			manifestService.Config["openapiPath"] = targetRel
		case "fixtures":
			manifestService.Config["fixturesPath"] = targetRel
			manifestService.Config["fixturesIndex"] = strings.Join(manifestAsset.Files, "\n")
		case "init":
			manifestService.Config["initPath"] = targetRel
		case "init-script":
			appendConfigPaths(manifestService.Config, "initScripts", targetRel)
		case "init-scripts":
			appendConfigPaths(manifestService.Config, "initScripts", assetPaths(targetRel, manifestAsset.Files)...)
		case "seed":
			manifestService.Config["seedPath"] = targetRel
		case "seed-scripts":
			appendConfigPaths(manifestService.Config, "seedScripts", assetPaths(targetRel, manifestAsset.Files)...)
		}
	}
	if _, err := os.Stat(filepath.Join(serviceDir, "static", "index.html")); err == nil {
		manifestService.BrowserPath = filepath.ToSlash(filepath.Join("assets", service.Name, "static", "index.html"))
	}
	return manifestService, nil
}

func assetPaths(base string, files []string) []string {
	paths := make([]string, 0, len(files))
	for _, file := range files {
		paths = append(paths, filepath.ToSlash(filepath.Join(base, filepath.FromSlash(file))))
	}
	return paths
}

func appendConfigPaths(config map[string]string, key string, paths ...string) {
	values := []string{}
	if existing := strings.TrimSpace(config[key]); existing != "" {
		values = append(values, strings.Split(existing, "\n")...)
	}
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path != "" {
			values = append(values, path)
		}
	}
	config[key] = strings.Join(values, "\n")
}

func demoStorageNamespace(composeFile string) string {
	absCompose, err := filepath.Abs(composeFile)
	if err != nil {
		absCompose = composeFile
	}
	sum := sha256.Sum256([]byte(filepath.ToSlash(filepath.Clean(absCompose))))
	return "ps-" + hex.EncodeToString(sum[:])[:16]
}

func unsupportedError(analysis *compose.Analysis) error {
	var builder strings.Builder
	fmt.Fprintf(&builder, "project is not browser-native yet; unsupported services:")
	for _, service := range analysis.Services {
		if service.BrowserNative {
			continue
		}
		fmt.Fprintf(&builder, "\n  %s:", service.Name)
		for _, reason := range service.Unsupported {
			fmt.Fprintf(&builder, "\n    - %s", reason)
		}
	}
	fmt.Fprint(&builder, "\n\nPocketStack is browser-only now: adapt services to static assets, WebAssembly, browser databases, or mocks.")
	return fmt.Errorf("%s", builder.String())
}

func copyTree(source, destination string) ([]string, error) {
	return copyTreeFiltered(source, destination, func(string, os.DirEntry) bool {
		return true
	})
}

func copyTreeFiltered(source, destination string, include func(string, os.DirEntry) bool) ([]string, error) {
	return copyTreeFilteredWithSkip(source, destination, include, skipProjectDir)
}

func copyDirectoryAsset(asset compose.AssetAnalysis, destination string) ([]string, error) {
	if asset.Name == "static" {
		return copyTreeFilteredWithSkipTransform(asset.Source, destination, func(string, os.DirEntry) bool {
			return true
		}, nil, staticAssetTransform)
	}
	return copyTree(asset.Source, destination)
}

func copyTreeFilteredWithSkip(source, destination string, include func(string, os.DirEntry) bool, skip func(string) bool) ([]string, error) {
	return copyTreeFilteredWithSkipTransform(source, destination, include, skip, nil)
}

func copyTreeFilteredWithSkipTransform(source, destination string, include func(string, os.DirEntry) bool, skip func(string) bool, transform func(string, []byte) []byte) ([]string, error) {
	var files []string
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(destination, 0o755)
		}
		if entry.IsDir() && skip != nil && skip(entry.Name()) {
			return filepath.SkipDir
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil
		}
		if !include(filepath.ToSlash(rel), entry) {
			return nil
		}
		if transform != nil {
			if err := copyFileTransform(path, target, rel, transform); err != nil {
				return err
			}
		} else if err := copyFile(path, target); err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(files)
	return files, err
}

func copyStaticFile(source, destination, rel string) error {
	return copyFileTransform(source, destination, rel, staticAssetTransform)
}

func staticAssetRel(target string) string {
	rel := strings.TrimPrefix(filepath.ToSlash(target), "static/")
	if rel == "" || rel == "." {
		return filepath.Base(target)
	}
	return rel
}

func skipProjectDir(name string) bool {
	switch name {
	case ".git", "node_modules", ".pocketstack", "dist", "coverage", ".cache":
		return true
	default:
		return false
	}
}

func copyFile(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyFileTransform(source, destination, rel string, transform func(string, []byte) []byte) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if transform != nil {
		data = transform(filepath.ToSlash(rel), data)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	return os.WriteFile(destination, data, info.Mode().Perm())
}

func staticAssetTransform(rel string, data []byte) []byte {
	ext := strings.ToLower(filepath.Ext(rel))
	switch ext {
	case ".html", ".htm", ".css":
	default:
		return data
	}
	prefix := staticRootRelativePrefix(rel)
	text := string(data)
	replacements := []struct {
		old string
		new string
	}{
		{`="/`, `="` + prefix},
		{`='/`, `='` + prefix},
		{`url(/`, `url(` + prefix},
		{`url("/`, `url("` + prefix},
		{`url('/`, `url('` + prefix},
	}
	for _, replacement := range replacements {
		text = strings.ReplaceAll(text, replacement.old, replacement.new)
	}
	text = strings.ReplaceAll(text, `="`+prefix+`/`, `="//`)
	text = strings.ReplaceAll(text, `='`+prefix+`/`, `='//`)
	text = strings.ReplaceAll(text, `url(`+prefix+`/`, `url(//`)
	text = strings.ReplaceAll(text, `url("`+prefix+`/`, `url("//`)
	text = strings.ReplaceAll(text, `url('`+prefix+`/`, `url('//`)
	return []byte(text)
}

func staticRootRelativePrefix(rel string) string {
	dir := path.Dir(filepath.ToSlash(rel))
	if dir == "." || dir == "/" {
		return "./"
	}
	depth := len(strings.Split(strings.Trim(dir, "/"), "/"))
	return strings.Repeat("../", depth)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func writeRuntime(outputDir string) error {
	return fs.WalkDir(runtimeFS, "runtime", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		data, err := runtimeFS.ReadFile(path)
		if err != nil {
			return err
		}
		target := filepath.Join(outputDir, filepath.Base(path))
		return os.WriteFile(target, data, 0o644)
	})
}

func writeHostConfigs(outputDir string, requirements compose.HostRequirements) error {
	if !requirements.CrossOriginIsolationRequired {
		return nil
	}
	lines := []string{
		"/*",
		"  Cross-Origin-Opener-Policy: same-origin",
		"  Cross-Origin-Embedder-Policy: require-corp",
		"",
	}
	if err := os.WriteFile(filepath.Join(outputDir, "_headers"), []byte(strings.Join(lines, "\n")), 0o644); err != nil {
		return err
	}
	headerValues := map[string]string{
		"Cross-Origin-Embedder-Policy": "require-corp",
		"Cross-Origin-Opener-Policy":   "same-origin",
	}
	vercel := map[string]any{
		"headers": []map[string]any{
			{
				"source": "/(.*)",
				"headers": []map[string]string{
					{"key": "Cross-Origin-Opener-Policy", "value": headerValues["Cross-Origin-Opener-Policy"]},
					{"key": "Cross-Origin-Embedder-Policy", "value": headerValues["Cross-Origin-Embedder-Policy"]},
				},
			},
		},
	}
	if err := writeJSON(filepath.Join(outputDir, "vercel.json"), vercel); err != nil {
		return err
	}
	staticWebApp := map[string]any{
		"globalHeaders": headerValues,
	}
	return writeJSON(filepath.Join(outputDir, "staticwebapp.config.json"), staticWebApp)
}

func writeIndex(path string, manifest Manifest) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return indexTemplate.Execute(file, manifest)
}

func cloneMap(values map[string]string) map[string]string {
	result := map[string]string{}
	for key, value := range values {
		result[key] = value
	}
	return result
}

var indexTemplate = template.Must(template.New("index").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PocketStack Demo</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f2;
      --panel: #ffffff;
      --ink: #18211f;
      --muted: #60706c;
      --line: #d9dfdc;
      --accent: #096b72;
      --danger: #a33b2f;
      --ok: #28734f;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101413;
        --panel: #171d1b;
        --ink: #eef5f2;
        --muted: #a2b1ad;
        --line: #2b3431;
        --accent: #46bbc0;
        --danger: #f08b7d;
        --ok: #7bd6a5;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 0 22px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 1rem; letter-spacing: 0; }
    .layout {
      min-height: calc(100vh - 64px);
      display: grid;
      grid-template-columns: minmax(240px, 320px) 1fr;
    }
    nav {
      border-right: 1px solid var(--line);
      background: var(--panel);
      padding: 16px;
      overflow: auto;
    }
    .service-button, .toolbar button {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--ink);
      cursor: pointer;
      font: inherit;
    }
    .service-button {
      width: 100%;
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 11px;
      text-align: left;
    }
    .service-button + .service-button { margin-top: 8px; }
    .service-button[aria-current="true"] {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }
    .tag { color: var(--muted); font-size: .78rem; white-space: nowrap; }
    main {
      min-width: 0;
      display: grid;
      grid-template-rows: auto minmax(260px, 1fr) 220px;
    }
    .status, .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      font-size: .9rem;
    }
    .toolbar { border-bottom: 0; border-top: 1px solid var(--line); background: var(--panel); }
    .toolbar button { width: auto; padding: 8px 11px; }
    .preview {
      min-width: 0;
      min-height: 0;
      background: #fff;
      position: relative;
    }
    iframe {
      width: 100%;
      height: 100%;
      min-height: 360px;
      border: 0;
      background: white;
    }
    .panel {
      padding: 24px;
      max-width: 860px;
      line-height: 1.55;
    }
    pre {
      margin: 0;
      height: 100%;
      overflow: auto;
      padding: 14px 18px;
      background: color-mix(in srgb, var(--panel) 70%, var(--bg));
      border-top: 1px solid var(--line);
      color: var(--ink);
      font-size: .86rem;
      white-space: pre-wrap;
    }
    .ok { color: var(--ok); }
    .danger { color: var(--danger); }
    @media (max-width: 760px) {
      .layout { grid-template-columns: 1fr; }
      nav { border-right: 0; border-bottom: 1px solid var(--line); }
      main { grid-template-rows: auto minmax(360px, 1fr) 220px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>PocketStack Demo</h1>
    <span>{{.Mode}} · manifest v{{.Version}}</span>
  </header>
  <div id="app" class="layout">
    <nav aria-label="Services">
      {{range .Services}}
        <button class="service-button" type="button" data-service="{{.Name}}">
          <span>{{.Name}}</span>
          <span class="tag">{{.Adapter}}</span>
        </button>
      {{end}}
    </nav>
    <main>
      <div class="status">
        <span id="status" role="status" aria-live="polite">Loading runtime</span>
        <span>browser-only</span>
      </div>
      <section id="preview" class="preview"></section>
      <div class="toolbar">
        <span id="details">Ready</span>
        <span>
          <button type="button" id="start">Start</button>
          <button type="button" id="reset">Reset</button>
        </span>
      </div>
      <pre id="logs" role="log" aria-live="polite" aria-label="Service logs"></pre>
    </main>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
`))
