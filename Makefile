# One command for the whole app: the daemon, and the site pointed at it. Ports are asked of
# the OS rather than fixed, so a second checkout can be up at the same time as this one.
# Any one of them falling over takes the rest with it — half an app up is worse than none,
# and quieter about it. `make desktop` is the same stack with the window in front of it.
.PHONY: dev desktop

free_port = $$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

daemon = (cd daemon && BROODMOTHER_PORT=$$api \
  BROODMOTHER_WEB_ORIGINS=http://127.0.0.1:$$web,http://localhost:$$web \
  npm run --silent dev; kill 0)
site = (cd frontend && PORT=$$web NEXT_PUBLIC_API_URL=http://127.0.0.1:$$api \
  npm run --silent dev; kill 0)
window = (cd desktop && BROODMOTHER_URL=http://127.0.0.1:$$web \
  npm run --silent dev; kill 0)

dev: daemon/node_modules frontend/node_modules
	@api=$(free_port); web=$(free_port); \
	echo "daemon http://127.0.0.1:$$api — site http://127.0.0.1:$$web"; \
	trap 'kill 0' INT TERM; \
	$(daemon) & \
	$(site) & \
	wait

desktop: daemon/node_modules frontend/node_modules desktop/node_modules
	@api=$(free_port); web=$(free_port); \
	echo "daemon http://127.0.0.1:$$api — site http://127.0.0.1:$$web — in a window"; \
	trap 'kill 0' INT TERM; \
	$(daemon) & \
	$(site) & \
	$(window) & \
	wait

daemon/node_modules frontend/node_modules desktop/node_modules: %/node_modules: %/package-lock.json
	cd $* && npm install
	@touch $@
