// Command daemon is the broodmother server.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/broodmotherai/broodmother/daemon-go/internal/api"
)

// `make dev` hands out ports so two checkouts can run at once; alone, the usual one.
func port() int {
	raw, ok := os.LookupEnv("BROODMOTHER_PORT")
	if !ok {
		return 0
	}
	chosen, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return chosen
}

func main() {
	server, err := api.Start(api.Options{Port: port()})
	if err != nil {
		fmt.Fprintln(os.Stderr, "broodmother:", err)
		os.Exit(1)
	}

	where := "no project yet — set one up in " + server.Context.Home
	if open := server.Context.Config().ProjectPath; open != nil {
		where = *open
	}
	fmt.Printf("broodmother server on %s — %s\n", server.URL, where)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	server.Context.Close()
	if err := server.Close(context.Background()); err != nil {
		fmt.Fprintln(os.Stderr, "broodmother:", err)
		os.Exit(1)
	}
}
