package api

import (
	"fmt"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// D-UPDATER-001: honest updater diagnostics.
//
// Production Wails builds install a logger that writes to io.Discard, so a
// warning sent to app.Logger is invisible in a shipped binary. The
// package-level slog logger is the one that honours AMAZINGWHATS_LOG_FILE
// (see main.go), so every updater failure must be recorded through it with
// the real error instead of a generic toast string.
//
// These helpers live in a separate file so cmd/run.go can use them without
// depending on Api internals, and so api.go can replace its generic
// "Could not check for updates." message with a real reason.

// LogUpdaterSnapshot records the exact version inputs used to configure the
// updater. A difference between rawVersion and currentVersion is expected —
// the build-type suffix ("-release" / "-nightly") is stripped — but seeing
// both values in a support log makes a version-normalisation mismatch
// diagnosable instead of silent.
func LogUpdaterSnapshot(rawVersion, currentVersion, repository, checksumAsset string) {
	slog.Info("updater configured",
		"source", "updater",
		"rawVersion", rawVersion,
		"currentVersion", currentVersion,
		"repository", repository,
		"checksumAsset", checksumAsset,
	)
}

// LogUpdaterFailure records a provider / init / check failure with its real
// error. It never returns a value: failures are non-fatal by design so the
// application can run offline and in development builds.
func LogUpdaterFailure(stage string, err error) {
	if err == nil {
		return
	}
	slog.Warn("updater failure", "source", "updater", "stage", stage, "error", err)
}

// ReportUpdaterFailure logs the full failure and surfaces a bounded, honest
// message to the renderer. Intended to replace the generic
// "Could not check for updates." string so a failed update says why it
// failed.
//
// The renderer message is truncated because provider errors can embed GitHub
// API response bodies; the complete text is always written to the log first.
func ReportUpdaterFailure(app *application.App, stage string, err error) {
	if err == nil {
		return
	}
	LogUpdaterFailure(stage, err)

	msg := fmt.Sprintf("Update %s failed: %v", stage, err)
	const maxMessage = 300
	if len(msg) > maxMessage {
		msg = msg[:maxMessage] + "…"
	}
	if app != nil {
		app.Event.Emit("wa:update_error", msg)
	}
}
