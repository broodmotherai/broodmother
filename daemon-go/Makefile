# One shape, matching the other trees in this repo. `corpus` belongs to the checkout root,
# because it is generated from the browser's TypeScript rather than from this tree.
.PHONY: dev build start vet test clean

dev:
	go run ./cmd/daemon

build:
	go build -o bin/broodmother-daemon ./cmd/daemon

start: dev

vet:
	gofmt -l . | tee /dev/stderr | (! read)
	go vet ./...

test:
	go test ./...

clean:
	rm -rf bin
