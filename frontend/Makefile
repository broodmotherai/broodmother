# One shape, matching the other trees in this repo.
.PHONY: dev build start vet test

dev:
	npm run dev

build:
	npm run build

start: build
	npm run start

vet:
	npm run typecheck
	npm run --silent lint

test: vet
	npm run --silent test
