# One command for the whole app: the daemon, and the site pointed at it. Ports are asked of
# the OS rather than fixed, so a second checkout can be up at the same time as this one.
.PHONY: dev

free_port = $$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

dev: daemon/node_modules frontend/node_modules
	@api=$(free_port); web=$(free_port); \
	echo "daemon http://127.0.0.1:$$api — site http://127.0.0.1:$$web"; \
	trap 'kill 0' INT TERM; \
	(cd daemon && BROODMOTHER_PORT=$$api \
	  BROODMOTHER_WEB_ORIGINS=http://127.0.0.1:$$web,http://localhost:$$web \
	  npm run --silent dev) & \
	(cd frontend && PORT=$$web NEXT_PUBLIC_API_URL=http://127.0.0.1:$$api \
	  npm run --silent dev) & \
	wait

daemon/node_modules frontend/node_modules: %/node_modules: %/package-lock.json
	cd $* && npm install
	@touch $@
