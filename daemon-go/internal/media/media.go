// Package media is what a file in a tree is, by its name — the one question a tree answers
// without opening anything.
package media

import "github.com/broodmotherai/broodmother/daemon-go/internal/utils"

var imageTypes = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
	"avif": "image/avif",
	"bmp":  "image/bmp",
	"ico":  "image/x-icon",
	"svg":  "image/svg+xml",
}

func ImageTypeOf(path string) string { return imageTypes[utils.Extension(path)] }
