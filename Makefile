PORT ?= 4173
BINARY := bin/pocketstack$(shell go env GOEXE)
RACE := $(if $(filter 1,$(shell go env CGO_ENABLED)),-race)

.PHONY: test build lint fuzz demo runtime studio media smoke pages release-check release-local release-dry-run verify-checksums

test:
	go test $(RACE) ./...
	npm run test:runtime
	npm run test:action

build:
	npm run build:wasi-example
	npm run build:runtime
	go build -o $(BINARY) ./cmd/pocketstack

lint:
	node -e "const cp=require('node:child_process');const out=cp.execFileSync('gofmt',['-l','cmd','internal'],{encoding:'utf8'});if(out){console.error(out);process.exit(1)}"
	go vet ./...
	staticcheck ./...
	govulncheck ./...

fuzz:
	go test ./internal/compose -run=^$$ -fuzz=FuzzParseProject -fuzztime=5s -parallel=2
	go test ./internal/compose -run=^$$ -fuzz=FuzzPortSpec -fuzztime=5s -parallel=2
	go test ./internal/compose -run=^$$ -fuzz=FuzzVolumeSpec -fuzztime=5s -parallel=2
	go test ./internal/analyzer -run=^$$ -fuzz=FuzzParseEnvFile -fuzztime=5s -parallel=2

demo:
	go run ./cmd/pocketstack demo -f examples/static-site/compose.yaml -o dist/static-site

runtime:
	npm run build:wasi-example
	npm run build:runtime

studio:
	python3 -m http.server $(PORT) --directory web/studio

media:
	npm run media

smoke: build
	rm -rf dist/static-site dist/frontend dist/full-stack dist/wasi dist/mock-api dist/postgres-pglite dist/sqlite dist/uploaded-static-blog dist/uploaded-mock-catalog dist/uploaded-sqlite-notes dist/showcase-storefront dist/showcase-sprint-board dist/showcase-analytics
	$(BINARY) demo -f examples/static-site/compose.yaml -o dist/static-site
	$(BINARY) demo -f examples/frontend/compose.yaml -o dist/frontend
	$(BINARY) demo -f examples/full-stack/compose.yaml -o dist/full-stack
	$(BINARY) demo -f examples/wasi/compose.yaml -o dist/wasi
	$(BINARY) demo -f examples/mock-api/compose.yaml -o dist/mock-api
	$(BINARY) demo -f examples/postgres-pglite/compose.yaml -o dist/postgres-pglite
	$(BINARY) demo -f examples/sqlite/compose.yaml -o dist/sqlite
	$(BINARY) demo -f examples/uploaded/static-blog/compose.yaml -o dist/uploaded-static-blog
	$(BINARY) demo -f examples/uploaded/mock-catalog/compose.yaml -o dist/uploaded-mock-catalog
	$(BINARY) demo -f examples/uploaded/sqlite-notes/compose.yaml -o dist/uploaded-sqlite-notes
	$(BINARY) demo -f examples/showcase/storefront/compose.yaml -o dist/showcase-storefront
	$(BINARY) demo -f examples/showcase/sprint-board/compose.yaml -o dist/showcase-sprint-board
	$(BINARY) demo -f examples/showcase/analytics/compose.yaml -o dist/showcase-analytics
	npm run test:smoke

pages: smoke
	npm run docs:build
	npm run pages:build

release-check: build test lint fuzz smoke release-local
	$(MAKE) verify-checksums

release-local: build
	node scripts/release-local.mjs

release-dry-run:
	goreleaser release --snapshot --clean

verify-checksums:
	node scripts/verify-checksums.mjs
