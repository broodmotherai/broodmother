// Starting and stopping one. The port is asked of the OS where nothing names one, so a second
// checkout can be up at the same time as this one.

package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
)

type Options struct {
	app.Options
	// Port is what to listen on. Zero is the usual one; a negative port asks the OS for whichever
	// is free, which is how a test starts one without claiming the port a real daemon wants.
	Port int
}

type Server struct {
	Context *app.Context
	Port    int
	URL     string

	server   *http.Server
	listener net.Listener
	done     chan error
}

// Start listens before it returns, so a caller that has the URL has somewhere to send to.
func Start(options Options) (*Server, error) {
	ctx, err := app.New(options.Options)
	if err != nil {
		return nil, err
	}

	port := options.Port
	if port < 0 {
		port = 0
	} else if port == 0 {
		port = constants.Port
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", constants.Host, port))
	if err != nil {
		return nil, err
	}

	server := &Server{
		Context:  ctx,
		Port:     listener.Addr().(*net.TCPAddr).Port,
		server:   &http.Server{Handler: New(ctx)},
		listener: listener,
		done:     make(chan error, 1),
	}
	server.URL = fmt.Sprintf("http://%s:%d", constants.Host, server.Port)
	go func() { server.done <- server.server.Serve(listener) }()
	// The clocks start once there is an address to write down: a schedule is mirrored into cron
	// as a line that curls this daemon, and before it is listening there is nothing to curl.
	ctx.Start(server.URL)
	return server, nil
}

// Close stops serving and waits for what is in flight. A server that was never started closes
// without complaint, which is what a deferred close in a test wants.
func (s *Server) Close(ctx context.Context) error {
	if err := s.server.Shutdown(ctx); err != nil {
		return err
	}
	if err := <-s.done; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
