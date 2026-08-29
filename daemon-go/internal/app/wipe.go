// Everything on this machine, gone.

package app

import (
	"os"
	"path/filepath"

	"github.com/broodmotherai/broodmother/daemon-go/internal/config"
)

// RemoveEverything takes every folder in the home and starts again on a config that names
// nothing. The last resort, and the one route that cannot be undone.
//
// What is open is closed before the folders go, or the watcher reports the deletion of a project
// nobody is in and the shells sit in a working directory that no longer exists.
func (c *Context) RemoveEverything() (config.Config, error) {
	if c.sync != nil {
		c.sync.ClearConflict()
	}
	// The project is let go of before its folder does: what is open is a tree and two watchers
	// standing on a path that is about to stop existing.
	c.mutex.Lock()
	open := c.open
	c.open = nil
	c.mutex.Unlock()
	open.close()

	entries, err := os.ReadDir(c.Home)
	if err != nil {
		return config.Config{}, err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(c.Home, entry.Name())); err != nil {
			return config.Config{}, err
		}
	}
	saved, err := c.Store.Save(config.Default(nil))
	if err != nil {
		return config.Config{}, err
	}
	if err := c.Profiles.Load(); err != nil {
		return config.Config{}, err
	}
	c.UseProject()
	return saved, nil
}
