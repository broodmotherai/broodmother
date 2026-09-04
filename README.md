# broodmother

## Running it

```sh
make dev            # the daemon and the site, in your browser
make desktop        # the same, in a window of its own
```

The daemon and the site together, on ports asked of the OS rather than fixed, so a second
checkout can be up beside this one. It prints where each landed and installs what any of them
is missing. `make desktop` adds the Electron window, pointed at wherever the site landed.
Each tree runs on its own too — see `daemon/`, `frontend/` and `desktop/`.
