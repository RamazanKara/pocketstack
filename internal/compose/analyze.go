package compose

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
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

	envFileEmbeddingWarning = "env_file values are embedded in the static demo; do not include secrets."
	postgresInitTarget      = "/docker-entrypoint-initdb.d"
)

type Analysis struct {
	ComposeFile      string            `json:"composeFile"`
	ProjectRoot      string            `json:"projectRoot"`
	Mode             string            `json:"mode"`
	BrowserNative    bool              `json:"browserNative"`
	Readiness        Readiness         `json:"readiness"`
	Services         []ServiceAnalysis `json:"services"`
	HostRequirements HostRequirements  `json:"hostRequirements,omitempty"`
	Warnings         []string          `json:"warnings,omitempty"`
	NextSteps        []string          `json:"nextSteps,omitempty"`
}

type HostRequirements struct {
	CrossOriginIsolationRequired bool              `json:"crossOriginIsolationRequired,omitempty"`
	NetworkAccessRequired        bool              `json:"networkAccessRequired,omitempty"`
	Headers                      map[string]string `json:"headers,omitempty"`
}

type Readiness struct {
	Status                string `json:"status"`
	BrowserNativeServices int    `json:"browserNativeServices"`
	TotalServices         int    `json:"totalServices"`
	Score                 int    `json:"score"`
	Summary               string `json:"summary"`
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
	Suggestions      []string          `json:"suggestions,omitempty"`
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
	skippedProfiles := make([]string, 0)
	for name, service := range project.Services {
		// Services gated behind `profiles:` are not started by a default
		// `docker compose up`, so they should not count toward (or block)
		// browser readiness. Mirror Compose's default activation set.
		if len(service.Profiles) > 0 {
			skippedProfiles = append(skippedProfiles, name)
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	sort.Strings(skippedProfiles)

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

	if len(skippedProfiles) > 0 {
		analysis.Warnings = append(analysis.Warnings, fmt.Sprintf("Ignored %d profile-gated service(s) not started by default: %s.", len(skippedProfiles), strings.Join(skippedProfiles, ", ")))
	}

	if !analysis.BrowserNative {
		analysis.Warnings = append(analysis.Warnings, "PocketStack is browser-native only. Unsupported services need a browser adapter, static assets, WebAssembly, browser database, or mock.")
	}
	if analysis.HostRequirements.CrossOriginIsolationRequired {
		analysis.Warnings = append(analysis.Warnings, "This demo needs COOP/COEP headers for cross-origin isolation.")
	}
	if analysis.HostRequirements.NetworkAccessRequired {
		analysis.Warnings = append(analysis.Warnings, "This demo may access public package/runtime CDNs from the browser.")
	}
	analysis.Readiness = browserReadiness(analysis.Services)
	analysis.NextSteps = projectNextSteps(analysis.Services)
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
	if hasExtends(service) {
		result := baseServiceAnalysis(context, AdapterUnsupported)
		result.reject("extends: is not supported; PocketStack analyzes a single Compose file and does not resolve extended base services")
		result.Suggestions = []string{"Flatten this service: copy the image, labels, ports, and volumes from the extended base directly into the Compose file PocketStack analyzes."}
		return result
	}
	if explicit != "" {
		if !supportedExplicitAdapter(explicit) {
			result := baseServiceAnalysis(context, AdapterUnsupported)
			if explicit == AdapterStaticWeb {
				result.reject("static-web is autodetected; do not set pocketstack.adapter=static-web")
			} else {
				result.reject(fmt.Sprintf("unknown PocketStack adapter %q", explicit))
			}
			result.Suggestions = suggestionsForService(context, result.Unsupported)
			return result
		}
		for _, current := range adapters() {
			if current.Name() == explicit {
				result := current.Analyze(context)
				if !result.BrowserNative {
					result.Suggestions = suggestionsForService(context, result.Unsupported)
				}
				return result
			}
		}
		result := baseServiceAnalysis(context, AdapterUnsupported)
		result.reject(fmt.Sprintf("unknown PocketStack adapter %q", explicit))
		result.Suggestions = suggestionsForService(context, result.Unsupported)
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
	result.Unsupported = primaryUnsupportedReasons(context, rejected)
	if len(result.Unsupported) == 0 {
		result.reject("no browser adapter matched this service")
	}
	result.Suggestions = suggestionsForService(context, result.Unsupported)
	return result
}

func supportedExplicitAdapter(name string) bool {
	switch name {
	case AdapterFrontend, AdapterWASI, AdapterMockHTTP, AdapterPostgresPGlite, AdapterSQLite:
		return true
	default:
		return false
	}
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

func browserReadiness(services []ServiceAnalysis) Readiness {
	total := len(services)
	native := 0
	for _, service := range services {
		if service.BrowserNative {
			native++
		}
	}
	score := 0
	if total > 0 {
		score = native * 100 / total
	}
	status := "blocked"
	switch {
	case total == 0:
		status = "blocked"
	case native == total:
		status = "ready"
	case native > 0:
		status = "partial"
	}
	summary := fmt.Sprintf("%d of %d services are browser-native", native, total)
	if status == "ready" {
		summary = "all services are browser-native"
	}
	return Readiness{
		Status:                status,
		BrowserNativeServices: native,
		TotalServices:         total,
		Score:                 score,
		Summary:               summary,
	}
}

func projectNextSteps(services []ServiceAnalysis) []string {
	steps := []string{}
	allNative := true
	for _, service := range services {
		if service.BrowserNative {
			continue
		}
		allNative = false
		for _, suggestion := range service.Suggestions {
			steps = appendUnique(steps, fmt.Sprintf("%s: %s", service.Name, suggestion))
		}
	}
	if allNative {
		return []string{"Run `pocketstack demo` to generate a static browser-native demo."}
	}
	if len(steps) == 0 {
		steps = append(steps, "Replace unsupported services with static assets, frontend projects, WASI modules, browser databases, or OpenAPI mocks.")
	}
	return steps
}

func primaryUnsupportedReasons(context adapterContext, rejected []string) []string {
	service := context.Service
	image := normalizedImage(service.Image)
	reasons := []string{}
	if service.Build != nil {
		reasons = append(reasons, "Docker build contexts cannot run in a browser-native demo")
	}
	if knownStatefulImage(image) {
		reasons = append(reasons, fmt.Sprintf("image %q is a stateful service without a direct browser-native container adapter", service.Image))
	}
	switch {
	case isStaticWebImage(service.Image):
		reasons = appendMatchingReasons(reasons, rejected, "static")
	case isFrontendImage(service.Image):
		reasons = appendMatchingReasons(reasons, rejected, "frontend", "package.json", "env_file")
	case image == "postgres":
		reasons = appendMatchingReasons(reasons, rejected, "postgres", "pocketstack.db")
	}
	if len(reasons) == 0 {
		if service.Image != "" {
			reasons = append(reasons, fmt.Sprintf("image %q does not map to a browser-native adapter", service.Image))
		} else {
			reasons = append(reasons, "service does not declare a supported browser-native adapter")
		}
	}
	return compactReasons(reasons)
}

func appendMatchingReasons(values, rejected []string, needles ...string) []string {
	for _, reason := range rejected {
		lower := strings.ToLower(reason)
		for _, needle := range needles {
			if strings.Contains(lower, strings.ToLower(needle)) {
				values = append(values, reason)
				break
			}
		}
	}
	return values
}

func suggestionsForService(context adapterContext, reasons []string) []string {
	service := context.Service
	image := normalizedImage(service.Image)
	suggestions := []string{}
	if context.Explicit != "" && !supportedExplicitAdapter(context.Explicit) {
		suggestions = appendUnique(suggestions, "Use a supported explicit adapter: frontend, wasi, mock-http, postgres-pglite, or sqlite.")
	}
	if service.Build != nil {
		suggestions = appendUnique(suggestions, "Run the Docker build before PocketStack and expose the browser-ready output as static files, frontend source, WASI, fixtures, or SQL seed data.")
	}
	for _, reason := range reasons {
		lower := strings.ToLower(reason)
		switch {
		case strings.Contains(lower, "static-web is autodetected"):
			suggestions = appendUnique(suggestions, "Remove `pocketstack.adapter=static-web`; use an nginx, httpd, or caddy image with a document-root bind mount.")
		case strings.Contains(lower, "no local static asset") && isStaticWebImage(service.Image):
			suggestions = appendUnique(suggestions, "Mount local static files at the image document root, for example `./site:/usr/share/nginx/html:ro`.")
		case strings.Contains(lower, "package.json") && (context.Explicit == AdapterFrontend || isFrontendImage(service.Image)):
			suggestions = appendUnique(suggestions, "Mount or upload the frontend source directory that contains `package.json`.")
		case (strings.Contains(lower, "dev/start script") || strings.Contains(lower, "frontend.start")) && (context.Explicit == AdapterFrontend || isFrontendImage(service.Image)):
			suggestions = appendUnique(suggestions, "Add a `dev` or `start` package script, or set `pocketstack.frontend.start`.")
		case (strings.Contains(lower, "openapi") || strings.Contains(lower, "fixtures")) && context.Explicit == AdapterMockHTTP:
			suggestions = appendUnique(suggestions, "For HTTP APIs, add `pocketstack.adapter=mock-http` with an OpenAPI file and/or JSON fixtures.")
		case (strings.Contains(lower, ".wasm") || strings.Contains(lower, "wasi")) && context.Explicit == AdapterWASI:
			suggestions = appendUnique(suggestions, "Compile the service to a prebuilt WASI `.wasm` module and reference it with `pocketstack.wasi.module`.")
		case strings.Contains(lower, "env_file"):
			suggestions = appendUnique(suggestions, "Include required env files in the uploaded project or mark optional env files with `required: false`.")
		}
	}
	switch {
	case knownStatefulImage(image):
		suggestions = appendUnique(suggestions, "For demos, replace this stateful service with SQLite, PGlite, fixtures, or in-browser mock state.")
	case image == "postgres":
		suggestions = appendUnique(suggestions, "Keep Postgres demo data in `.sql` init/seed files so PocketStack can run it with PGlite.")
	case isStaticWebImage(service.Image):
		suggestions = appendUnique(suggestions, "Use only document-root file mounts for browser-native static previews; server rewrites and custom config are not emulated.")
	}
	if len(service.Ports) > 0 && context.Explicit == "" && !knownStatefulImage(image) && !isStaticWebImage(service.Image) && !isFrontendImage(service.Image) && image != "postgres" {
		suggestions = appendUnique(suggestions, "If this is an HTTP service, model the demo surface as `mock-http` instead of trying to run the container.")
	}
	if len(suggestions) == 0 {
		suggestions = appendUnique(suggestions, "Choose a browser-native representation: static-web, frontend, WASI, mock-http, postgres-pglite, or sqlite.")
	}
	return suggestions
}

func appendUnique(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func knownStatefulImage(image string) bool {
	switch image {
	case "mysql", "mariadb", "mongo", "mongodb", "redis", "valkey", "memcached":
		return true
	default:
		return false
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
	configTargets := configTargetsForImage(service.Image)
	var ignoredConfigMounts []string
	staticAssetCount := 0
	for _, volume := range service.Volumes {
		if volume.IsBindLike() && matchesStaticConfigTarget(configTargets, volume.Target) {
			ignoredConfigMounts = append(ignoredConfigMounts, volume.Target)
		}
		if !volume.IsBindLike() {
			continue
		}
		source := volume.ResolveSource(context.ProjectRoot)
		staticRoot, rel, ok := staticDocumentMount(staticTargets, volume.Target)
		if !ok {
			continue
		}
		target := staticAssetTarget(source, rel)
		switch {
		case isDir(source):
			if result.AssetSource == "" {
				result.StaticRoot = staticRoot
				result.AssetSource = source
			}
			result.addAsset("static", "directory", source, target)
			staticAssetCount++
		case fileExists(source):
			if result.AssetSource == "" {
				result.StaticRoot = staticRoot
				result.AssetSource = source
			}
			result.addAsset("static", "file", source, target)
			staticAssetCount++
		default:
			result.reject(fmt.Sprintf("static asset source %s does not exist", source))
		}
	}
	if staticAssetCount == 0 {
		result.reject("no local static asset file or directory is mounted at the image's document root")
	}
	if len(ignoredConfigMounts) > 0 {
		sort.Strings(ignoredConfigMounts)
		result.Config["ignoredConfigMounts"] = strings.Join(ignoredConfigMounts, "\n")
		result.Warnings = append(result.Warnings, "static-web packages document-root files only; mounted nginx/httpd/caddy config is not emulated, so redirects, rewrites, custom headers, auth, and compression may differ.")
	}
	result.PublicPort = firstPort(service, defaultPortForImage(service.Image))
	return result
}

func staticDocumentMount(staticTargets []string, target string) (string, string, bool) {
	for _, staticTarget := range staticTargets {
		rel, ok := containerRelativePath(staticTarget, target)
		if ok {
			return cleanContainerPath(staticTarget), rel, true
		}
	}
	return "", "", false
}

func staticAssetTarget(source, rel string) string {
	rel = strings.TrimSpace(rel)
	if rel == "" || rel == "." {
		if fileExists(source) {
			return filepath.ToSlash(filepath.Join("static", filepath.Base(source)))
		}
		return "static"
	}
	return filepath.ToSlash(filepath.Join("static", filepath.FromSlash(rel)))
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
	source := frontendSource(context.ProjectRoot, service, "package.json")
	if source == "" {
		result.reject("frontend adapter requires a package.json in the project root or a bind-mounted source directory")
		return result
	}
	metadata, err := packageMetadata(filepath.Join(source, "package.json"))
	if err != nil {
		result.reject(err.Error())
		return result
	}
	manager := detectPackageManager(source, service.Image, metadata.PackageManager)
	start := frontendStartCommand(context.Labels, service.Entrypoint, service.Command)
	if start == "" {
		switch {
		case metadata.Scripts["dev"] != "":
			start = defaultRunCommand(manager, "dev")
		case metadata.Scripts["start"] != "":
			start = defaultRunCommand(manager, "start")
		default:
			result.reject("frontend adapter requires a dev/start script or pocketstack.frontend.start label")
		}
	}
	install := frontendInstallCommand(context.Labels, source, manager, start)
	result.AssetSource = source
	result.PublicPort = labelInt(context.Labels, LabelFrontendPort, firstPort(service, 3000))
	result.Config["install"] = install
	result.Config["start"] = start
	result.Config["port"] = strconv.Itoa(result.PublicPort)
	result.Config["packageManager"] = manager
	if env, ok := browserEnvironment(context.ProjectRoot, service, &result); ok && len(env) > 0 {
		result.Config["env"] = strings.Join(env, "\n")
	}
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

func frontendStartCommand(labels map[string]string, entrypoint, composeCommand any) string {
	if start := strings.TrimSpace(labels[LabelFrontendStart]); start != "" {
		return start
	}
	return composeEntrypointCommandString(entrypoint, composeCommand)
}

func frontendInstallCommand(labels map[string]string, source, manager, start string) string {
	if install := strings.TrimSpace(labels[LabelFrontendInstall]); install != "" {
		return install
	}
	if frontendCommandInstallsDependencies(start) {
		return ""
	}
	return defaultInstallCommand(source, manager)
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
	if env, ok := browserEnvironment(context.ProjectRoot, context.Service, &result); ok && len(env) > 0 {
		result.Config["env"] = strings.Join(env, "\n")
	}
	result.addAsset("module", "file", module, "module.wasm")
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
		} else if !isOpenAPIPath(openAPI) {
			result.reject(fmt.Sprintf("OpenAPI file %s must be .yaml, .yml, or .json", openAPI))
		}
		result.addAsset("openapi", "file", openAPI, "openapi"+filepath.Ext(openAPI))
	}
	if fixtures != "" {
		if !isDir(fixtures) {
			result.reject(fmt.Sprintf("fixtures directory %s does not exist", fixtures))
		} else {
			jsonFiles, skipped, err := jsonDirectoryFiles(fixtures)
			if err != nil {
				result.reject(fmt.Sprintf("read fixtures directory %s: %v", fixtures, err))
			} else if len(jsonFiles) == 0 {
				message := fmt.Sprintf("fixtures directory %s has no .json files PocketStack can serve", fixtures)
				if openAPI == "" {
					result.reject(message)
				} else {
					result.Warnings = append(result.Warnings, message)
				}
			} else {
				if len(skipped) > 0 {
					result.Warnings = append(result.Warnings, fmt.Sprintf("fixtures directory %s includes non-.json files that are not served by mock-http.", fixtures))
				}
				result.addAsset("fixtures", "json-directory", fixtures, "fixtures")
			}
		}
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
	persist, ok := dbPersistMode(context.Labels, &result)
	if !ok {
		return result
	}
	result.PublicPort = firstPort(context.Service, 5432)
	result.Config["persist"] = persist
	addOptionalSQLPath(&result, context.ProjectRoot, context.Labels[LabelDBInit], "init", "init.sql", false)
	addOptionalSQLPath(&result, context.ProjectRoot, context.Labels[LabelDBSeed], "seed", "seed.sql", false)
	addPostgresInitMounts(&result, context.ProjectRoot, context.Service)
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
	persist, ok := dbPersistMode(context.Labels, &result)
	if !ok {
		return result
	}
	result.Config["persist"] = persist
	addOptionalSQLPath(&result, context.ProjectRoot, context.Labels[LabelDBInit], "init", "init.sql", false)
	addOptionalSQLPath(&result, context.ProjectRoot, context.Labels[LabelDBSeed], "seed", "seed", true)
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

func addOptionalSQLPath(result *ServiceAnalysis, projectRoot, rawPath, name, targetBase string, preserveExt bool) {
	path := resolveProjectPath(projectRoot, rawPath)
	if path == "" {
		return
	}
	if isDir(path) {
		sqlFiles, skipped, err := sqlDirectoryFiles(path)
		if err != nil {
			result.reject(fmt.Sprintf("read %s directory %s: %v", name, path, err))
			return
		}
		if len(sqlFiles) == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s directory %s has no .sql files PocketStack can execute.", name, path))
			return
		}
		if len(skipped) > 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s directory %s includes non-.sql files that are not executed in browser-only mode.", name, path))
		}
		result.addAsset(name+"-scripts", "sql-directory", path, name+"-scripts")
		return
	}
	if !fileExists(path) {
		result.reject(fmt.Sprintf("%s file %s does not exist", name, path))
		return
	}
	if !validDatabaseAssetFile(path, preserveExt) {
		result.reject(fmt.Sprintf("%s file %s must be %s", name, path, databaseAssetFileExpectation(preserveExt)))
		return
	}
	target := targetBase
	if preserveExt {
		if ext := filepath.Ext(path); ext != "" && filepath.Ext(targetBase) == "" {
			target += ext
		}
	}
	result.addAsset(name, "file", path, target)
}

func addPostgresInitMounts(result *ServiceAnalysis, projectRoot string, service Service) {
	for _, volume := range service.Volumes {
		if !volume.IsBindLike() {
			continue
		}
		rel, ok := containerRelativePath(postgresInitTarget, volume.Target)
		if !ok {
			continue
		}
		source := volume.ResolveSource(projectRoot)
		if source == "" {
			continue
		}
		switch {
		case isDir(source):
			sqlFiles, skipped, err := sqlDirectoryFiles(source)
			if err != nil {
				result.reject(fmt.Sprintf("read Postgres init mount %s: %v", source, err))
				continue
			}
			if len(sqlFiles) == 0 {
				result.Warnings = append(result.Warnings, fmt.Sprintf("Postgres init mount %s has no .sql files PocketStack can execute.", source))
			} else {
				result.addAsset("init-scripts", "sql-directory", source, postgresInitAssetTarget(rel))
			}
			if len(skipped) > 0 {
				result.Warnings = append(result.Warnings, fmt.Sprintf("Postgres init mount %s includes non-.sql files that are not executed in browser-only mode.", source))
			}
		case fileExists(source):
			target := postgresInitFileTarget(source, rel)
			if !isSQLPath(source) && !isSQLPath(target) {
				result.Warnings = append(result.Warnings, fmt.Sprintf("Postgres init file %s is not .sql and is not executed in browser-only mode.", source))
				continue
			}
			result.addAsset("init-script", "file", source, filepath.ToSlash(filepath.Join("init-scripts", filepath.FromSlash(target))))
		default:
			result.reject(fmt.Sprintf("Postgres init mount source %s does not exist", source))
		}
	}
}

func postgresInitAssetTarget(rel string) string {
	if rel == "." || rel == "" {
		return "init-scripts"
	}
	return filepath.ToSlash(filepath.Join("init-scripts", filepath.FromSlash(rel)))
}

func postgresInitFileTarget(source, rel string) string {
	if rel == "." || rel == "" {
		return filepath.Base(source)
	}
	return rel
}

func sqlDirectoryFiles(source string) ([]string, []string, error) {
	var sqlFiles []string
	var skipped []string
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if entry.IsDir() && skipProjectDir(entry.Name()) {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if isSQLPath(rel) {
			sqlFiles = append(sqlFiles, rel)
		} else {
			skipped = append(skipped, rel)
		}
		return nil
	})
	sort.Strings(sqlFiles)
	sort.Strings(skipped)
	return sqlFiles, skipped, err
}

func jsonDirectoryFiles(source string) ([]string, []string, error) {
	var jsonFiles []string
	var skipped []string
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if entry.IsDir() && skipProjectDir(entry.Name()) {
			return filepath.SkipDir
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if isJSONPath(rel) {
			jsonFiles = append(jsonFiles, rel)
		} else {
			skipped = append(skipped, rel)
		}
		return nil
	})
	sort.Strings(jsonFiles)
	sort.Strings(skipped)
	return jsonFiles, skipped, err
}

func isOpenAPIPath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".yaml", ".yml", ".json":
		return true
	default:
		return false
	}
}

func isJSONPath(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".json")
}

func isSQLPath(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".sql")
}

func isSQLiteDatabasePath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".db", ".sqlite", ".sqlite3":
		return true
	default:
		return false
	}
}

func validDatabaseAssetFile(path string, allowSQLiteDatabase bool) bool {
	return isSQLPath(path) || (allowSQLiteDatabase && isSQLiteDatabasePath(path))
}

func databaseAssetFileExpectation(allowSQLiteDatabase bool) string {
	if allowSQLiteDatabase {
		return ".sql, .db, .sqlite, or .sqlite3"
	}
	return ".sql"
}

func skipProjectDir(name string) bool {
	switch name {
	case ".git", "node_modules", ".pocketstack", "dist", "coverage", ".cache":
		return true
	default:
		return false
	}
}

func browserEnvironment(projectRoot string, service Service, result *ServiceAnalysis) ([]string, bool) {
	values := map[string]string{}
	usedEnvFile := false
	for _, envFile := range service.EnvFiles() {
		envPath := resolveProjectPath(projectRoot, envFile.Path)
		if envPath == "" {
			continue
		}
		data, err := os.ReadFile(envPath)
		if err != nil {
			if envFile.Required {
				result.reject(fmt.Sprintf("env_file %s does not exist", envPath))
				return nil, false
			}
			result.Warnings = append(result.Warnings, fmt.Sprintf("optional env_file %s does not exist and was skipped", envPath))
			continue
		}
		usedEnvFile = true
		mergeEnvironment(values, parseEnvFile(string(data), envPath, result))
	}
	mergeEnvironment(values, service.EnvironmentList())
	if usedEnvFile {
		result.Warnings = append(result.Warnings, envFileEmbeddingWarning)
	}
	return sortedEnvironment(values), true
}

func parseEnvFile(raw, envPath string, result *ServiceAnalysis) []string {
	entries := []string{}
	for lineNumber, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if !ok {
			result.Warnings = append(result.Warnings, fmt.Sprintf("env_file %s line %d has no value; PocketStack will set it to an empty string instead of reading host environment.", envPath, lineNumber+1))
			entries = append(entries, key+"=")
			continue
		}
		entries = append(entries, key+"="+trimEnvValue(value))
	}
	return entries
}

func trimEnvValue(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 2 {
		return value
	}
	first := value[0]
	last := value[len(value)-1]
	if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

func mergeEnvironment(values map[string]string, entries []string) {
	for _, entry := range entries {
		key, value, ok := strings.Cut(entry, "=")
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if !ok {
			value = ""
		}
		values[key] = strings.TrimSpace(value)
	}
}

func sortedEnvironment(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+values[key])
	}
	return env
}

type packageInfo struct {
	Scripts        map[string]string
	PackageManager string
}

func packageMetadata(path string) (packageInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return packageInfo{}, fmt.Errorf("read package.json: %w", err)
	}
	var payload struct {
		Scripts        map[string]string `json:"scripts"`
		PackageManager string            `json:"packageManager"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return packageInfo{}, fmt.Errorf("parse package.json: %w", err)
	}
	if payload.Scripts == nil {
		payload.Scripts = map[string]string{}
	}
	return packageInfo{Scripts: payload.Scripts, PackageManager: payload.PackageManager}, nil
}

func detectPackageManager(source, image, declared string) string {
	if manager := normalizePackageManager(declared); manager != "" {
		return manager
	}
	switch {
	case fileExists(filepath.Join(source, "bun.lockb")) || fileExists(filepath.Join(source, "bun.lock")):
		return "bun"
	case fileExists(filepath.Join(source, "pnpm-lock.yaml")):
		return "pnpm"
	case fileExists(filepath.Join(source, "yarn.lock")):
		return "yarn"
	case fileExists(filepath.Join(source, "package-lock.json")) || fileExists(filepath.Join(source, "npm-shrinkwrap.json")):
		return "npm"
	case isBunImage(image):
		return "bun"
	default:
		return "npm"
	}
}

func normalizePackageManager(raw string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return ""
	}
	name, _, _ := strings.Cut(raw, "@")
	switch name {
	case "npm", "pnpm", "yarn", "bun":
		return name
	default:
		return ""
	}
}

func defaultInstallCommand(source, manager string) string {
	switch manager {
	case "bun":
		return "bun install"
	case "pnpm":
		return "pnpm install"
	case "yarn":
		return "yarn install"
	}
	if fileExists(filepath.Join(source, "package-lock.json")) {
		return "npm ci"
	}
	return "npm install"
}

func frontendCommandInstallsDependencies(command string) bool {
	normalized := strings.ToLower(strings.Join(strings.Fields(command), " "))
	if normalized == "" {
		return false
	}
	installCommands := []string{
		"npm install",
		"npm i",
		"npm ci",
		"pnpm install",
		"pnpm i",
		"yarn install",
		"bun install",
		"bun i",
	}
	for _, current := range installCommands {
		if commandContainsShellWordSequence(normalized, current) {
			return true
		}
	}
	return false
}

func commandContainsShellWordSequence(command, sequence string) bool {
	index := strings.Index(command, sequence)
	for index >= 0 {
		beforeOK := index == 0 || strings.ContainsRune(" \t\n;&|()\"'", rune(command[index-1]))
		afterIndex := index + len(sequence)
		afterOK := afterIndex == len(command) || strings.ContainsRune(" \t\n;&|()\"'", rune(command[afterIndex]))
		if beforeOK && afterOK {
			return true
		}
		next := strings.Index(command[index+1:], sequence)
		if next < 0 {
			return false
		}
		index += next + 1
	}
	return false
}

func defaultRunCommand(manager, script string) string {
	if script == "start" {
		switch manager {
		case "bun":
			return "bun run start -- --host 0.0.0.0"
		case "pnpm":
			return "pnpm start -- --host 0.0.0.0"
		case "yarn":
			return "yarn run start -- --host 0.0.0.0"
		default:
			return "npm start -- --host 0.0.0.0"
		}
	}
	switch manager {
	case "bun":
		return "bun run " + script + " -- --host 0.0.0.0"
	case "pnpm":
		return "pnpm run " + script + " -- --host 0.0.0.0"
	case "yarn":
		return "yarn run " + script + " -- --host 0.0.0.0"
	default:
		return "npm run " + script + " -- --host 0.0.0.0"
	}
}

func composeCommandString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		parts := make([]string, 0, len(typed))
		for _, part := range typed {
			parts = append(parts, fmt.Sprint(part))
		}
		return joinCommandParts(parts)
	case []string:
		return joinCommandParts(typed)
	default:
		return ""
	}
}

func composeEntrypointCommandString(entrypoint, command any) string {
	entrypointText := composeCommandString(entrypoint)
	commandText := composeCommandString(command)
	if entrypointText == "" {
		return commandText
	}
	if commandText == "" {
		return entrypointText
	}
	if isCommandList(entrypoint) {
		if commandString, ok := command.(string); ok {
			commandText = quoteCommandPart(strings.TrimSpace(commandString))
		}
	}
	return strings.TrimSpace(entrypointText + " " + commandText)
}

func isCommandList(value any) bool {
	switch value.(type) {
	case []any, []string:
		return true
	default:
		return false
	}
}

func joinCommandParts(parts []string) string {
	quoted := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		quoted = append(quoted, quoteCommandPart(part))
	}
	return strings.Join(quoted, " ")
}

func quoteCommandPart(part string) string {
	if !strings.ContainsAny(part, " \t\n\"'") {
		return part
	}
	if !strings.Contains(part, `"`) {
		return `"` + part + `"`
	}
	if !strings.Contains(part, `'`) {
		return `'` + part + `'`
	}
	return strings.ReplaceAll(part, " ", `\ `)
}

func frontendSource(projectRoot string, service Service, filename string) string {
	if source := bindSourceForWorkingDir(projectRoot, service.Volumes, service.WorkingDir, filename); source != "" {
		return source
	}
	if source := firstBindWithFile(projectRoot, service.Volumes, filename); source != "" {
		return source
	}
	if fileExists(filepath.Join(projectRoot, filename)) {
		return projectRoot
	}
	return ""
}

func bindSourceForWorkingDir(projectRoot string, volumes []VolumeSpec, workingDir, filename string) string {
	workingDir = cleanContainerPath(workingDir)
	if workingDir == "" {
		return ""
	}
	for _, volume := range volumes {
		if !volume.IsBindLike() {
			continue
		}
		rel, ok := containerRelativePath(volume.Target, workingDir)
		if !ok {
			continue
		}
		source := filepath.Join(volume.ResolveSource(projectRoot), filepath.FromSlash(rel))
		if fileExists(filepath.Join(source, filename)) {
			return source
		}
	}
	return ""
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

func containerRelativePath(base, target string) (string, bool) {
	base = cleanContainerPath(base)
	target = cleanContainerPath(target)
	if base == "" || target == "" {
		return "", false
	}
	if target == base {
		return ".", true
	}
	prefix := base
	if prefix != "/" {
		prefix += "/"
	}
	if strings.HasPrefix(target, prefix) {
		return strings.TrimPrefix(target, prefix), true
	}
	return "", false
}

func cleanContainerPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return path.Clean(value)
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

func dbPersistMode(labels map[string]string, result *ServiceAnalysis) (string, bool) {
	value := strings.TrimSpace(labels[LabelDBPersist])
	if value == "" {
		return "indexeddb", true
	}
	switch value {
	case "indexeddb", "memory":
		return value, true
	default:
		result.reject(fmt.Sprintf("pocketstack.db.persist must be indexeddb or memory, got %q", value))
		return "", false
	}
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
		isBunImage(image) ||
		strings.HasSuffix(normalized, "/node") ||
		strings.HasSuffix(normalized, "/bun")
}

func isBunImage(image string) bool {
	normalized := normalizedImage(image)
	return normalized == "bun" || normalized == "oven/bun"
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

func configTargetsForImage(image string) []string {
	switch normalizedImage(image) {
	case "httpd":
		return []string{"/usr/local/apache2/conf", "/usr/local/apache2/conf/httpd.conf", "/etc/apache2", "/etc/httpd"}
	case "caddy":
		return []string{"/etc/caddy", "/etc/caddy/Caddyfile", "/config/caddy"}
	default:
		return []string{"/etc/nginx", "/etc/nginx/nginx.conf", "/etc/nginx/conf.d", "/etc/nginx/templates"}
	}
}

func matchesStaticConfigTarget(targets []string, target string) bool {
	target = filepath.Clean(target)
	for _, current := range targets {
		current = filepath.Clean(current)
		if target == current || strings.HasPrefix(target, current+"/") {
			return true
		}
	}
	return false
}

func defaultPortForImage(image string) int {
	switch normalizedImage(image) {
	case "caddy", "httpd", "nginx", "nginxinc/nginx-unprivileged":
		return 80
	default:
		return 0
	}
}

func hasExtends(service Service) bool {
	switch value := service.Extends.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(value) != ""
	default:
		return true
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
	// Strip an explicit registry host (the first path segment when it looks
	// like a hostname, e.g. "docker.io/", "ghcr.io/", "localhost:5000/") so
	// fully-qualified references normalize to the same repo name as the short
	// form. Plain namespaces such as "nginxinc/" are preserved.
	if first, rest, ok := strings.Cut(image, "/"); ok {
		if strings.ContainsAny(first, ".:") || first == "localhost" {
			image = rest
		}
	}
	// Strip Docker Hub's implicit "library/" namespace so "library/postgres"
	// and "docker.io/library/postgres" match the bare "postgres".
	image = strings.TrimPrefix(image, "library/")
	return image
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
