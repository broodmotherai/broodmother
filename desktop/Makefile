# One shape, matching the other trees in this repo, plus the targets that are this tree's own
# reason to exist: a .app with the whole application inside it, that .app in /Applications,
# and the disk image the download page hands out.
.PHONY: dev build start vet test bundle package dmg install uninstall clean

ARCH    := $(shell uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')
VERSION := $(shell node -p "require('./package.json').version")
APP     := out/broodmother-darwin-$(ARCH)/broodmother.app
DEST    := /Applications/broodmother.app
DMG     := out/broodmother-$(VERSION)-$(ARCH).dmg

dev:
	npm run dev

build:
	npm run compile

start: dev

vet:
	npm run typecheck

test: vet

# What the .app carries besides the window. The site is built as a Next standalone server —
# its own `node_modules`, its own `server.js` — and the daemon goes in as the source it is,
# because `tsx` is what runs it here the same as in a checkout. Neither tree brings a Node:
# Electron already has one, and `serve.ts` starts both children on it.
bundle: build/icon.icns
	rm -rf build/site build/daemon
	mkdir -p build/site build/daemon
	cd ../frontend && npm run build
	cp -R ../frontend/.next/standalone/. build/site/
	cp -R ../frontend/.next/static build/site/frontend/.next/static
	cp -R ../frontend/public build/site/frontend/public
	cp -R ../daemon/src ../daemon/package.json ../daemon/tsconfig.json build/daemon/
	cp -R ../daemon/node_modules build/daemon/node_modules

# The app's own mark, at every size the Finder asks for. `sips` and `iconutil` are macOS's
# own, so the icon costs the repo no dependency.
build/icon.icns:
	rm -rf build/icon.iconset
	mkdir -p build/icon.iconset
	for size in 16 32 128 256 512; do \
	  sips -z $$size $$size ../frontend/public/logo.png \
	    --out build/icon.iconset/icon_$${size}x$${size}.png >/dev/null; \
	  sips -z $$(($$size * 2)) $$(($$size * 2)) ../frontend/public/logo.png \
	    --out build/icon.iconset/icon_$${size}x$${size}@2x.png >/dev/null; \
	done
	iconutil -c icns build/icon.iconset -o build/icon.icns

# The .app, built for whichever Mac is building it, with both servers inside it.
package: build bundle
	npm run --silent package

# The disk image, with the drop target beside it that every Mac download has.
dmg: package
	rm -rf out/dmg "$(DMG)"
	mkdir -p out/dmg
	cp -R "$(APP)" out/dmg/
	ln -s /Applications out/dmg/Applications
	hdiutil create -volname "broodmother $(VERSION)" -srcfolder out/dmg -ov -format UDZO "$(DMG)"
	@echo "$(DMG)"

# Replaced rather than merged: a stale file left inside a bundle is a bug you cannot see.
install: package
	rm -rf "$(DEST)"
	cp -R "$(APP)" "$(DEST)"
	@echo "installed $(DEST)"

uninstall:
	rm -rf "$(DEST)"

clean:
	rm -rf dist out build
