# One command for the whole app: the daemon, and the site pointed at it. Ports are asked of
# the OS rather than fixed, so a second checkout can be up at the same time as this one.
# Either one falling over takes the other with it — half an app up is worse than none, and
# quieter about it.
.PHONY: dev e2e e2e-ui e2e-web

free_port = $$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

dev: daemon/node_modules frontend/node_modules
	@api=$(free_port); web=$(free_port); \
	echo "daemon http://127.0.0.1:$$api — site http://127.0.0.1:$$web"; \
	trap 'kill 0' INT TERM; \
	(cd daemon && BROODMOTHER_PORT=$$api \
	  BROODMOTHER_WEB_ORIGINS=http://127.0.0.1:$$web,http://localhost:$$web \
	  npm run --silent dev; kill 0) & \
	(cd frontend && PORT=$$web NEXT_PUBLIC_API_URL=http://127.0.0.1:$$api \
	  npm run --silent dev; kill 0) & \
	wait

# The end-to-end suite: a real daemon on a temp home, the built site, and the shell. The site
# is built and the shell compiled every time — 14 seconds against a run that tests the last
# checkout is not a trade worth making — and one build serves every worker.
e2e: e2e/node_modules frontend/node_modules desktop/node_modules
	cd frontend && npm run --silent build
	cd desktop && npm run --silent compile
	cd e2e && npm run --silent test -- $(ARGS)

# The same suite in Playwright's UI mode, and the browser tier in a browser you can watch.
e2e-ui: ARGS = --ui
e2e-ui: e2e

e2e-web: ARGS = --project=web --headed
e2e-web: e2e

daemon/node_modules frontend/node_modules desktop/node_modules e2e/node_modules: %/node_modules: %/package-lock.json
	cd $* && npm install
	@touch $@
