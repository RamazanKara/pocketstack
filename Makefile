.PHONY: test build lint demo runtime smoke release-dry-run

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

smoke: build
	rm -rf dist/static-site dist/frontend dist/wasi dist/mock-api dist/postgres-pglite dist/sqlite
	bin/pocketstack demo -f examples/static-site/compose.yaml -o dist/static-site
	bin/pocketstack demo -f examples/frontend/compose.yaml -o dist/frontend
	bin/pocketstack demo -f examples/wasi/compose.yaml -o dist/wasi
	bin/pocketstack demo -f examples/mock-api/compose.yaml -o dist/mock-api
	bin/pocketstack demo -f examples/postgres-pglite/compose.yaml -o dist/postgres-pglite
	bin/pocketstack demo -f examples/sqlite/compose.yaml -o dist/sqlite
	npm run test:smoke

release-dry-run:
	goreleaser release --snapshot --clean --skip=publish
