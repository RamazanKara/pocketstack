package compose

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	ModeBrowserNative = "browser-native"
	ModeUnsupported   = "unsupported"

	AdapterStaticWeb      = "static-web"
	AdapterFrontend       = "frontend"
	AdapterWASI           = "wasi"
	AdapterMockHTTP       = "mock-http"
	AdapterPostgresPGlite = "postgres-pglite"
	AdapterSQLite         = "sqlite"
	AdapterUnsupported    = "unsupported"
	LabelAdapter          = "pocketstack.adapter"
	LabelFrontendInstall  = "pocketstack.frontend.install"
	LabelFrontendStart    = "pocketstack.frontend.start"
	LabelFrontendPort     = "pocketstack.frontend.port"
	LabelWASIModule       = "pocketstack.wasi.module"
	LabelWASIArgs         = "pocketstack.wasi.args"
	LabelMockOpenAPI      = "pocketstack.mock.openapi"
	LabelMockFixtures     = "pocketstack.mock.fixtures"
	LabelMockPort         = "pocketstack.mock.port"
	LabelDBInit           = "pocketstack.db.init"
	LabelDBSeed           = "pocketstack.db.seed"
	LabelDBPersist        = "pocketstack.db.persist"
)

type Analysis struct {
	ComposeFile      string            `json:"composeFile"`
	ProjectRoot      string            `json:"projectRoot"`
	Mode             string            `json:"mode"`
	BrowserNative    bool              `json:"browserNative"`
	Services         []ServiceAnalysis `json:"services"`
	HostRequirements HostRequirements  `json:"hostRequirements,omitempty"`
	Warnings         []string          `json:"warnings,omitempty"`
}

type HostRequirements struct {
	CrossOriginIsolationRequired bool              `json:"crossOriginIsolationRequired,omitempty"`
	NetworkAccessRequired        bool              `json:"networkAccessRequired,omitempty"`
	Headers                      map[string]string `json:"headers,omitempty"`
}

type ServiceAnalysis struct {
	Name             string            `json:"name"`
	Image            string            `json:"image,omitempty"`
	Adapter          string            `json:"adapter,omitempty"`
	BrowserNative    bool              `json:"browserNative"`
	StaticRoot       string            `json:"staticRoot,omitempty"`
	AssetSource      string            `json:"assetSource,omitempty"`
	PublicPort       int               `json:"publicPort,omitempty"`
	Assets           []AssetAnalysis   `json:"assets,omitempty"`
	Config           map[string]string `json:"config,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	HostRequirements HostRequirements  `json:"hostRequirements,omitempty"`
	Warnings         []string          `json:"warnings,omitempty"`
	Unsupported      []string          `json:"unsupported,omitempty"`
}

type AssetAnalysis struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type adapter interface {
	Name() string
	Analyze(context adapterContext) ServiceAnalysis
}

type adapterContext struct {
	Name        string
	Service     Service
	ProjectRoot string
	Labels      map[string]string
	Explicit    string
}

func AnalyzeFile(composeFile string) (*Analysis, error) {
	absCompose, err := filepath.Abs(composeFile)
	if err != nil {
		return nil, err
	}
	project, err := LoadFile(absCompose)
	if err != nil {
		return nil, err
	}
	projectRoot := filepath.Dir(absCompose)
	analysis := Analyze(project, projectRoot, absCompose)
	return &analysis, nil
}

func Analyze(project *Project, projectRoot, composeFile string) Analysis {
	names := make([]string, 0, len(project.Services))
	for name := range project.Services {
		names = append(names, name)
	}
	sort.Strings(names)

	analysis := Analysis{
		ComposeFile:   composeFile,
		ProjectRoot:   projectRoot,
		BrowserNative: true,
		Mode:          ModeBrowserNative,
		Services:      make([]ServiceAnalysis, 0, len(names)),
	}

	for _, name := range names {
		serviceAnalysis := analyzeService(name, project.Services[name], projectRoot)
		if !serviceAnalysis.BrowserNative {
			analysis.BrowserNative = false
			analysis.Mode = ModeUnsupported
		}
		analysis.HostRequirements = mergeHostRequirements(analysis.HostRequirements, serviceAnalysis.HostRequirements)
		analysis.Services = append(analysis.Services, serviceAnalysis)
	}

	if !analysis.BrowserNative {
		analysis.Warnings = append(analysis.Warnings, "PocketStack is browser-only. Unsupported services must be adapted to static assets, WebAssembly, browser databases, or mocks.")
	}
	if analysis.HostRequirements.CrossOriginIsolationRequired {
		analysis.Warnings = append(analysis.Warnings, "This demo needs COOP/COEP headers for cross-origin isolation.")
	}
	if analysis.HostRequirements.NetworkAccessRequired {
		analysis.Warnings = append(analysis.Warnings, "This demo may access public package/runtime CDNs from the browser.")
	}
	return analysis
}

func analyzeService(name string, service Service, projectRoot string) ServiceAnalysis {
	labels := service.LabelMap()
	explicit := strings.TrimSpace(labels[LabelAdapter])
	context := adapterContext{
		Name:        name,
		Service:     service,
		ProjectRoot: projectRoot,
		Labels:      labels,
		Explicit:    explicit,
	}
	if explicit != "" {
		for _, current := range adapters() {
			if current.Name() == explicit {
				return current.Analyze(context)
			}
		}
		result := baseServiceAnalysis(context, AdapterUnsupported)
		result.reject(fmt.Sprintf("unknown PocketStack adapter %q", explicit))
		return result
	}

	var rejected []string
	for _, current := range adapters() {
		result := current.Analyze(context)
		if result.BrowserNative {
			return result
		}
		rejected = append(rejected, result.Unsupported...)
	}

	result := baseServiceAnalysis(context, AdapterUnsupported)
	result.BrowserNative = false
	result.Adapter = AdapterUnsupported
	result.Unsupported = compactReasons(rejected)
	if len(result.Unsupported) == 0 {
		result.reject("no browser adapter matched this service")
	}
	return result
}

func adapters() []adapter {
	return []adapter{
		staticWebAdapter{},
		frontendAdapter{},
		wasiAdapter{},
		mockHTTPAdapter{},
		postgresAdapter{},
		sqliteAdapter{},
	}
}

type staticWebAdapter struct{}

func (staticWebAdapter) Name() string { return AdapterStaticWeb }

func (staticWebAdapter) Analyze(context adapterContext) ServiceAnalysis {
	result := baseServiceAnalysis(context, AdapterStaticWeb)
	service := context.Service
	if context.Explicit != "" && context.Explicit != AdapterStaticWeb {
		result.reject("adapter mismatch")
		return result
	}
	if service.Image == "" {
		result.reject("static-web requires an image such as nginx, httpd, or caddy")
	}
	if service.Build != nil {
		result.reject("static-web cannot run Docker build contexts in the browser")
	}
	if hasValue(service.Command) {
		result.reject("static-web cannot execute custom commands")
	}
	if hasValue(service.Entrypoint) {
		result.reject("static-web cannot execute custom entrypoints")
	}
	if !isStaticWebImage(service.Image) {
		result.reject(fmt.Sprintf("image %q is not in the static-web allowlist", service.Image))
	}
	staticTargets := staticTargetsForImage(service.Image)
	for _, volume := range service.Volumes {
		if !volume.IsBindLike() || !contains(staticTargets, volume.Target) {
			continue
		}
		source := volume.ResolveSource(context.ProjectRoot)
		if isDir(source) {
			result.StaticRoot = volume.Target
			result.AssetSource = source
			result.addAsset("static", "directory", source, "static")
			break
		}
	}
	if result.AssetSource == "" {
		result.reject("no local static asset directory is mounted at the image's document root")
	}
	result.PublicPort = firstPort(service, defaultPortForImage(service.Image))
	return result
}

type frontendAdapter struct{}

func (frontendAdapter) Name() string { return AdapterFrontend }

func (frontendAdapter) Analyze(context adapterContext) ServiceAnalysis {
	result := baseServiceAnalysis(context, AdapterFrontend)
	service := context.Service
	if context.Explicit != "" && context.Explicit != AdapterFrontend {
		result.reject("adapter mismatch")
		return result
	}
	if service.Build != nil {
		result.reject("frontend adapter requires a local source mount, not a Docker build context")
	}
	if context.Explicit == "" && !isFrontendImage(service.Image) {
		result.reject(fmt.Sprintf("image %q is not a Node/Bun frontend image", service.Image))
	}
	source := firstBindWithFile(context.ProjectRoot, service.Volumes, "package.json")
	if source == "" && fileExists(filepath.Join(context.ProjectRoot, "package.json")) {
		source = context.ProjectRoot
	}
	if source == "" {
		result.reject("frontend adapter requires a package.json in a bind-mounted source directory")
		return result
	}
	scripts, err := packageScripts(filepath.Join(source, "package.json"))
	if err != nil {
		result.reject(err.Error())
		return result
	}
	install := labelDefault(context.Labels, LabelFrontendInstall, defaultInstallCommand(source))
	start := strings.TrimSpace(context.Labels[LabelFrontendStart])
	if start == "" {
		switch {
		case scripts["dev"] != "":
			start = "npm run dev -- --host 0.0.0.0"
		case scripts["start"] != "":
			start = "npm start -- --host 0.0.0.0"
		default:
			result.reject("frontend adapter requires a dev/start script or pocketstack.frontend.start label")
		}
	}
	result.AssetSource = source
	result.PublicPort = labelInt(context.Labels, LabelFrontendPort, firstPort(service, 3000))
	result.Config["install"] = install
	result.Config["start"] = start
	result.Config["port"] = strconv.Itoa(result.PublicPort)
	result.addAsset("project", "directory", source, "project")
	result.HostRequirements = HostRequirements{
		CrossOriginIsolationRequired: true,
		NetworkAccessRequired:        true,
		Headers: map[string]string{
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy":   "same-origin",
		},
	}
	return result
}

type wasiAdapter struct{}

func (wasiAdapter) Name() string { return AdapterWASI }

func (wasiAdapter) Analyze(context adapterContext) ServiceAnalysis {
	result := baseServiceAnalysis(context, AdapterWASI)
	if context.Explicit != AdapterWASI {
		result.reject("wasi adapter requires pocketstack.adapter=wasi")
		return result
	}
	module := resolveProjectPath(context.ProjectRoot, context.Labels[LabelWASIModule])
	if module == "" {
		result.reject("wasi adapter requires pocketstack.wasi.module")
		return result
	}
	if filepath.Ext(module) != ".wasm" {
		result.reject("pocketstack.wasi.module must point to a prebuilt .wasm file")
	}
	if !fileExists(module) {
		result.reject(fmt.Sprintf("WASI module %s does not exist", module))
	}
	result.Config["args"] = context.Labels[LabelWASIArgs]
	result.addAsset("module", "file", module, "module.wasm")
	result.HostRequirements.NetworkAccessRequired = true
	return result
}

type mockHTTPAdapter struct{}

func (mockHTTPAdapter) Name() string { return AdapterMockHTTP }

func (mockHTTPAdapter) Analyze(context adapterContext) ServiceAnalysis {
	result := baseServiceAnalysis(context, AdapterMockHTTP)
	if context.Explicit != AdapterMockHTTP {
		result.reject("mock-http adapter requires pocketstack.adapter=mock-http")
		return result
	}
	openAPI := resolveProjectPath(context.ProjectRoot, context.Labels[LabelMockOpenAPI])
	fixtures := resolveProjectPath(context.ProjectRoot, context.Labels[LabelMockFixtures])
	if openAPI == "" && fixtures == "" {
		result.reject("mock-http adapter requires pocketstack.mock.openapi or pocketstack.mock.fixtures")
		return result
	}
	if openAPI != "" {
		if !fileExists(openAPI) {
			result.reject(fmt.Sprintf("OpenAPI file %s does not exist", openAPI))
		}
		result.addAsset("openapi", "file", openAPI, "openapi"+filepath.Ext(openAPI))
	}
	if fixtures != "" {
		if !isDir(fixtures) {
			result.reject(fmt.Sprintf("fixtures directory %s does not exist", fixtures))
		}
		result.addAsset("fixtures", "directory", fixtures, "fixtures")
	}
	result.PublicPort = labelInt(context.Labels, LabelMockPort, firstPort(context.Service, 8080))
	result.Config["port"] = strconv.Itoa(result.PublicPort)
	return result
}

type postgresAdapter struct{}

func (postgresAdapter) Name() string { return AdapterPostgresPGlite }

func (postgresAdapter) Analyze(context adapterContext) ServiceAnalysis {
	result := baseServiceAnalysis(context, AdapterPostgresPGlite)
	if context.Explicit != "" && context.Explicit != AdapterPostgresPGlite {
		result.reject("adapter mismatch")
		return result
	}
	if context.Explicit == "" && normalizedImage(context.Service.Image) != "postgres" {
		result.reject(fmt.Sprintf("image %q is not postgres", context.Service.Image))
	}
	if context.Service.Build != nil {
		result.reject("postgres-pglite cannot run Docker build contexts")
	}
	if hasValue(context.Service.Command) || hasValue(context.Service.Entrypoint) {
		result.Warnings = append(result.Warnings, "Postgres command/entrypoint is ignored by the PGlite adapter.")
	}
	result.PublicPort = firstPort(context.Service, 5432)
	result.Config["persist"] = labelDefault(context.Labels, LabelDBPersist, "indexeddb")
	addOptionalFile(&result, context.ProjectRoot, context.Labels[LabelDBInit], "init", "init.sql")
	addOptionalFile(&result, context.ProjectRoot, context.Labels[LabelDBSeed], "seed", "seed.sql")
	result.HostRequirements.NetworkAccessRequired = true
	return result
}

type sqliteAdapter struct{}

func (sqliteAdapter) Name() string { return AdapterSQLite }

func (sqliteAdapter) Analyze(context adapterContext) ServiceAnalysis {
	result := baseServiceAnalysis(context, AdapterSQLite)
	if context.Explicit != AdapterSQLite {
		result.reject("sqlite adapter requires pocketstack.adapter=sqlite")
		return result
	}
	result.Config["persist"] = labelDefault(context.Labels, LabelDBPersist, "indexeddb")
	addOptionalFile(&result, context.ProjectRoot, context.Labels[LabelDBInit], "init", "init.sql")
	addOptionalFile(&result, context.ProjectRoot, context.Labels[LabelDBSeed], "seed", "seed")
	result.HostRequirements.NetworkAccessRequired = true
	return result
}

func baseServiceAnalysis(context adapterContext, adapterName string) ServiceAnalysis {
	return ServiceAnalysis{
		Name:          context.Name,
		Image:         context.Service.Image,
		Adapter:       adapterName,
		BrowserNative: true,
		Config:        map[string]string{},
		Labels:        context.Labels,
		PublicPort:    firstPort(context.Service, 0),
	}
}

func (s *ServiceAnalysis) reject(reason string) {
	s.BrowserNative = false
	s.Adapter = AdapterUnsupported
	s.Unsupported = append(s.Unsupported, reason)
}

func (s *ServiceAnalysis) addAsset(name, kind, source, target string) {
	if source == "" {
		return
	}
	s.Assets = append(s.Assets, AssetAnalysis{
		Name:   name,
		Kind:   kind,
		Source: source,
		Target: target,
	})
}

func addOptionalFile(result *ServiceAnalysis, projectRoot, rawPath, name, target string) {
	path := resolveProjectPath(projectRoot, rawPath)
	if path == "" {
		return
	}
	if !fileExists(path) {
		result.reject(fmt.Sprintf("%s file %s does not exist", name, path))
		return
	}
	result.addAsset(name, "file", path, target)
}

func packageScripts(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read package.json: %w", err)
	}
	var payload struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("parse package.json: %w", err)
	}
	if payload.Scripts == nil {
		payload.Scripts = map[string]string{}
	}
	return payload.Scripts, nil
}

func defaultInstallCommand(source string) string {
	if fileExists(filepath.Join(source, "package-lock.json")) {
		return "npm ci"
	}
	return "npm install"
}

func firstBindWithFile(projectRoot string, volumes []VolumeSpec, filename string) string {
	for _, volume := range volumes {
		if !volume.IsBindLike() {
			continue
		}
		source := volume.ResolveSource(projectRoot)
		if fileExists(filepath.Join(source, filename)) {
			return source
		}
	}
	return ""
}

func resolveProjectPath(projectRoot, rawPath string) string {
	rawPath = strings.TrimSpace(rawPath)
	if rawPath == "" {
		return ""
	}
	if filepath.IsAbs(rawPath) {
		return filepath.Clean(rawPath)
	}
	return filepath.Clean(filepath.Join(projectRoot, rawPath))
}

func labelDefault(labels map[string]string, key, fallback string) string {
	value := strings.TrimSpace(labels[key])
	if value == "" {
		return fallback
	}
	return value
}

func labelInt(labels map[string]string, key string, fallback int) int {
	raw := strings.TrimSpace(labels[key])
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func firstPort(service Service, fallback int) int {
	if len(service.Ports) > 0 && service.Ports[0].Target != 0 {
		return service.Ports[0].Target
	}
	if len(service.Expose) > 0 && service.Expose[0].Target != 0 {
		return service.Expose[0].Target
	}
	return fallback
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func hasValue(value any) bool {
	if value == nil {
		return false
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed) != ""
	case []any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return true
	}
}

func isStaticWebImage(image string) bool {
	switch normalizedImage(image) {
	case "nginx", "nginxinc/nginx-unprivileged", "httpd", "caddy":
		return true
	default:
		return false
	}
}

func isFrontendImage(image string) bool {
	normalized := normalizedImage(image)
	return normalized == "node" ||
		normalized == "bun" ||
		normalized == "oven/bun" ||
		strings.HasSuffix(normalized, "/node") ||
		strings.HasSuffix(normalized, "/bun")
}

func staticTargetsForImage(image string) []string {
	switch normalizedImage(image) {
	case "httpd":
		return []string{"/usr/local/apache2/htdocs", "/var/www/html"}
	case "caddy":
		return []string{"/srv", "/usr/share/caddy"}
	default:
		return []string{"/usr/share/nginx/html", "/var/www/html"}
	}
}

func defaultPortForImage(image string) int {
	switch normalizedImage(image) {
	case "caddy", "httpd", "nginx", "nginxinc/nginx-unprivileged":
		return 80
	default:
		return 0
	}
}

func normalizedImage(image string) string {
	image = strings.TrimSpace(strings.ToLower(image))
	if image == "" {
		return ""
	}
	if before, _, ok := strings.Cut(image, "@"); ok {
		image = before
	}
	lastSlash := strings.LastIndex(image, "/")
	lastColon := strings.LastIndex(image, ":")
	if lastColon > lastSlash {
		image = image[:lastColon]
	}
	return image
}

func contains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func compactReasons(values []string) []string {
	seen := map[string]bool{}
	var result []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == "adapter mismatch" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func mergeHostRequirements(left, right HostRequirements) HostRequirements {
	left.CrossOriginIsolationRequired = left.CrossOriginIsolationRequired || right.CrossOriginIsolationRequired
	left.NetworkAccessRequired = left.NetworkAccessRequired || right.NetworkAccessRequired
	if len(right.Headers) > 0 {
		if left.Headers == nil {
			left.Headers = map[string]string{}
		}
		for key, value := range right.Headers {
			left.Headers[key] = value
		}
	}
	return left
}
