//go:build !windows

package api

// applyStartAtLogin is a no-op off Windows: there is no per-user Run key to
// manage there. The setting remains harmless and is simply not applied.
func (a *Api) applyStartAtLogin() {}
