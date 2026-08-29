// Package browser is what a document is when it is looked at rather than read: which files the
// server will hand out as bytes, and what to call them on the way.
package browser

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/media"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

var browserTypes = map[string]string{
	"html": "text/html; charset=utf-8",
	"htm":  "text/html; charset=utf-8",
}

// subresourceTypes are what a page reaches for once it is on screen. The ordinary previewed
// document is a report written next to the stylesheet that makes it readable, not one file on
// its own.
var subresourceTypes = map[string]string{
	"css":   "text/css; charset=utf-8",
	"js":    "text/javascript; charset=utf-8",
	"mjs":   "text/javascript; charset=utf-8",
	"json":  "application/json; charset=utf-8",
	"map":   "application/json; charset=utf-8",
	"woff":  "font/woff",
	"woff2": "font/woff2",
	"ttf":   "font/ttf",
	"otf":   "font/otf",
}

// ServedTypeOf is the type to serve a file's bytes as, or empty for one this route has no
// business handing out. A short list rather than a general static server: the server behind it
// can write to every tree, so what it will answer for is worth keeping small enough to read.
func ServedTypeOf(path string) string {
	if kind := media.ImageTypeOf(path); kind != "" {
		return kind
	}
	extension := utils.Extension(path)
	if kind, named := browserTypes[extension]; named {
		return kind
	}
	return subresourceTypes[extension]
}

// Blank is where a browser tab starts. Not browsable — nothing may navigate to it — but a tab
// may open on it, which the desktop process permits separately.
const Blank = "about:blank"
