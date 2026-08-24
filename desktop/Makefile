# One shape, matching the other trees in this repo, plus the two targets that are this
# tree's own reason to exist: a .app, and that .app in /Applications.
.PHONY: dev build start vet test package install uninstall clean

APP  := out/broodmother-darwin-$(shell uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')/broodmother.app
DEST := /Applications/broodmother.app

dev:
	npm run dev

build:
	npm run compile

start: dev

vet:
	npm run typecheck

test: vet

# The .app, built for whichever Mac is building it.
package: build
	npm run --silent package

# Replaced rather than merged: a stale file left inside a bundle is a bug you cannot see.
install: package
	rm -rf "$(DEST)"
	cp -R "$(APP)" "$(DEST)"
	@echo "installed $(DEST)"

uninstall:
	rm -rf "$(DEST)"

clean:
	rm -rf dist out
