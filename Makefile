# One command for the whole app: the daemon, and the site pointed at it. Ports are asked of
# the OS rather than fixed, so a second checkout can be up at the same time as this one.
# Any one of them falling over takes the rest with it — half an app up is worse than none,
# and quieter about it. `make desktop` is the same stack with the window in front of it.
.PHONY: dev desktop test corpus

free_port = $$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

daemon = (cd daemon-go && BROODMOTHER_PORT=$$api \
  BROODMOTHER_WEB_ORIGINS=http://127.0.0.1:$$web,http://localhost:$$web \
  go run ./cmd/daemon; kill 0)
site = (cd frontend && PORT=$$web NEXT_PUBLIC_API_URL=http://127.0.0.1:$$api \
  npm run --silent dev; kill 0)
window = (cd desktop && BROODMOTHER_URL=http://127.0.0.1:$$web \
  npm run --silent dev; kill 0)

dev: frontend/node_modules
	@api=$(free_port); web=$(free_port); \
	echo "daemon http://127.0.0.1:$$api — site http://127.0.0.1:$$web"; \
	trap 'kill 0' INT TERM; \
	$(daemon) & \
	$(site) & \
	wait

desktop: frontend/node_modules desktop/node_modules
	@api=$(free_port); web=$(free_port); \
	echo "daemon http://127.0.0.1:$$api — site http://127.0.0.1:$$web — in a window"; \
	trap 'kill 0' INT TERM; \
	$(daemon) & \
	$(site) & \
	$(window) & \
	wait

frontend/node_modules desktop/node_modules: %/node_modules: %/package-lock.json
	cd $* && npm install
	@touch $@

# Both halves. The daemon is Go and the browser is TypeScript, and `conformance/` is what holds
# the first to the grammar the second reads.
test: frontend/node_modules
	cd daemon-go && go test ./...
	cd frontend && npm run --silent typecheck && npm test

# The conformance corpus, for the grammars the browser and the daemon both still parse. What it
# writes is what `daemon-go` is held to, so regenerating changes what the app accepts — read the
# diff before keeping it. `conformance/README.md` says which corpora are frozen and why.
corpus: frontend/node_modules
	cd frontend && npx tsx ../conformance/generate.ts
