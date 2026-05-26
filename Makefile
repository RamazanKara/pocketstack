PORT ?= 4173

.PHONY: test build lint demo runtime studio media smoke pages release-check release-dry-run verify-checksums

test:
	go test ./...
	npm run test:runtime

build:
	npm run build:wasi-example
	npm run build:runtime
	go build -o bin/pocketstack ./cmd/pocketstack

lint:
	go vet ./...

demo:
	go run ./cmd/pocketstack demo -f examples/static-site/compose.yaml -o dist/static-site

runtime:
	npm run build:wasi-example
	npm run build:runtime

studio:
	python3 -m http.server $(PORT) --directory studio

media:
	npm run media

smoke: build
	rm -rf dist/static-site dist/frontend dist/full-stack dist/wasi dist/mock-api dist/postgres-pglite dist/sqlite dist/uploaded-static-blog dist/uploaded-mock-catalog dist/uploaded-sqlite-notes
	bin/pocketstack demo -f examples/static-site/compose.yaml -o dist/static-site
	bin/pocketstack demo -f examples/frontend/compose.yaml -o dist/frontend
	bin/pocketstack demo -f examples/full-stack/compose.yaml -o dist/full-stack
	bin/pocketstack demo -f examples/wasi/compose.yaml -o dist/wasi
	bin/pocketstack demo -f examples/mock-api/compose.yaml -o dist/mock-api
	bin/pocketstack demo -f examples/postgres-pglite/compose.yaml -o dist/postgres-pglite
	bin/pocketstack demo -f examples/sqlite/compose.yaml -o dist/sqlite
	bin/pocketstack demo -f examples/uploaded/static-blog/compose.yaml -o dist/uploaded-static-blog
	bin/pocketstack demo -f examples/uploaded/mock-catalog/compose.yaml -o dist/uploaded-mock-catalog
	bin/pocketstack demo -f examples/uploaded/sqlite-notes/compose.yaml -o dist/uploaded-sqlite-notes
	npm run test:smoke

pages: smoke
	npm run pages:build

release-check: test lint smoke release-dry-run verify-checksums

release-dry-run:
	goreleaser release --snapshot --clean

verify-checksums:
	cd dist && sha256sum -c checksums.txt
