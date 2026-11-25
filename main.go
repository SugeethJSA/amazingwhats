package main

import (
	"embed"
	"fmt"
	"log"
	"os"

	"github.com/lugvitc/amazingwhats/cmd"
)

//go:embed all:frontend/dist
var assets embed.FS

// these variable are set at build time
var (
	version   = "0.0.0"
	commit    string
	date      string
	buildType = "unclassified"
)

func main() {
	// The production Windows build is a GUI-subsystem exe with no console, so
	// its stderr would otherwise be invisible. AMAZINGWHATS_LOG_FILE is an
	// opt-in used by tools/app-with-logs.ps1: both std streams and the standard
	// log package go to that file. ServiceStartup later builds the slog handler
	// from os.Stderr, so it inherits the same destination.
	if path := os.Getenv("AMAZINGWHATS_LOG_FILE"); path != "" {
		if f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
			os.Stdout = f
			os.Stderr = f
			log.SetOutput(f)
			log.Printf("amazingwhats logging to %s", path)
		}
	}
	os.Exit(runMain(os.Args, run))
}

func run(args []string) error {
	return cmd.Execute(args, assets, cmd.BuildArgs{
		Version:   version,
		Commit:    commit,
		Date:      date,
		BuildType: buildType,
	})
}

func runMain(args []string, runFunc func([]string) error) int {
	if err := runFunc(args); err != nil {
		fmt.Printf("%s: %s\n", cmd.AppName, err.Error())
		return 1
	}
	return 0
}
