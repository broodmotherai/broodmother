// What makes "have I written this before" answerable.
//
// Apart from the codec because the hash is the daemon's and the codec is everybody's: the
// browser reads a record the same way the server writes one, and a crypto import would be the
// one thing that stopped it. The seam is kept here for the same reason it is kept there.

package entity

import (
	"crypto/sha256"
	"encoding/hex"
)

func DigestOf(e Entity) string {
	sum := sha256.Sum256([]byte(CanonicalOf(e)))
	return hex.EncodeToString(sum[:])
}
