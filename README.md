# broodmother

## Running it

```sh
make dev
```

The daemon and the site together, on ports asked of the OS rather than fixed, so a second
checkout can be up beside this one. It prints where each landed and installs what either is
missing. Each tree runs on its own too — see `daemon/`, `frontend/`, `desktop/` and `e2e/`.

## Testing it

```sh
make e2e
```

The end-to-end suite: a real daemon on a temp home, the built site in a real browser, and the
shell. `make e2e-ui` is the same specs in Playwright's UI mode and `make e2e-web` is the
browser tier in a browser you can watch. The daemon and the frontend keep their own `npm test`
for what does not need the whole app up — see `e2e/README.md` for which is which.
