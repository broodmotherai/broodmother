# One shape, matching the other trees in this repo. The suite needs a built site and a
# compiled shell, which is why the root's `make e2e` is the way in rather than this.
.PHONY: dev build start vet test ui web report

dev: ui

build:

start: test

vet:
	npm run typecheck

test:
	npm run --silent test

# The same specs, watched rather than read about — the spec list, a re-run on save, the
# filmstrip and pick-locator.
ui:
	npm run --silent ui

# The browser tier in a browser you can see.
web:
	npm run --silent web

report:
	npm run --silent report
