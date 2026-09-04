package constants

import (
	"os"
	"strings"
	"time"
)

// Host is loopback only: there is no auth and full read/write access to the repo.
const (
	Host = "127.0.0.1"
	Port = 4242
)

// Heartbeat is how often a socket is asked whether anything is still on the other end of it.
const Heartbeat = 30 * time.Second

var defaultWebOrigins = []string{"http://localhost:4243", "http://127.0.0.1:4243"}

// WebOrigins is what CORS lets through. `make dev` picks its ports at run time and names the
// origins here; started on its own the daemon expects the site on the port it always uses.
func WebOrigins() []string {
	list, ok := os.LookupEnv("BROODMOTHER_WEB_ORIGINS")
	if !ok {
		return append([]string(nil), defaultWebOrigins...)
	}
	origins := []string{}
	for _, origin := range strings.Split(list, ",") {
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}
