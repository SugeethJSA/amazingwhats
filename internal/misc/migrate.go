package misc

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// legacyAppName is the on-disk directory name used before the runtime identity
// was renamed. It is deliberately a literal rather than a derived value so the
// migration always targets the old location, even though AppName has changed.
const legacyAppName = "whats4linux"

type migrationStats struct {
	files   int
	dirs    int
	links   int
	skipped int
}

// MigrateLegacyConfig is the exported entry point for embedders that override
// ConfigDir. Normal startup migrates from misc.defaultConfigDir() instead.
// MigrateLegacyConfig copies configuration data (settings, session, databases)
// from the pre-rename directory into the current ConfigDir. Both directories
// are siblings directly under os.UserConfigDir(), which is %APPDATA% on Windows
// and ~/.config on Linux/macOS.
//
// It is safe to call on every startup:
//   - nothing is copied when the legacy directory does not exist;
//   - entries already present in the new directory are never overwritten;
//   - the legacy directory is only ever read, never modified or deleted;
//   - a partially completed copy can be finished on a later startup.
//
// A single summary line is logged only when something was actually copied; it
// contains directory names, never file contents or secret-bearing paths.
func MigrateLegacyConfig() error {
	return migrateLegacyConfig(ConfigDir)
}

// migrateLegacyConfig is the implementation used both at package init (so the
// settings package reads migrated values on first start) and by callers that
// override the config directory.
func migrateLegacyConfig(newDir string) error {
	if newDir == "" {
		return fmt.Errorf("migrate legacy config: current config directory is empty")
	}
	legacyDir := filepath.Join(filepath.Dir(newDir), legacyAppName)
	if filepath.Clean(legacyDir) == filepath.Clean(newDir) {
		// Already running with the legacy directory as the config dir.
		return nil
	}

	info, err := os.Stat(legacyDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // fresh install, or migration already finished
		}
		return fmt.Errorf("migrate legacy config: stat %s: %w", legacyAppName, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("migrate legacy config: %s is not a directory", legacyAppName)
	}

	// ConfigDir is normally created at package init, but it may be overridden
	// (tests, embedded builds); make sure the destination exists before copying.
	if err := os.MkdirAll(newDir, configDirPerm); err != nil {
		return fmt.Errorf("migrate legacy config: create %s: %w", AppName, err)
	}

	var stats migrationStats
	if err := copyLegacyTree(legacyDir, newDir, &stats); err != nil {
		return err // every error is already wrapped with context
	}
	if stats.files+stats.dirs+stats.links > 0 {
		log.Printf("misc: migrated legacy config %s -> %s: copied %d file(s), %d dir(s), %d symlink(s), skipped %d existing entry/entries",
			legacyAppName, AppName, stats.files, stats.dirs, stats.links, stats.skipped)
	}
	return nil
}

// copyLegacyTree walks srcDir and recreates every entry under dstDir that is
// not already present. Existing destination entries are skipped, so a file
// written by the current version is always preserved.
func copyLegacyTree(srcDir, dstDir string, stats *migrationStats) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return fmt.Errorf("migrate legacy config: read %s: %w", legacyAppName, err)
	}
	for _, entry := range entries {
		src := filepath.Join(srcDir, entry.Name())
		dst := filepath.Join(dstDir, entry.Name())

		// SQLite WAL/SHM/JOURNAL sidecars belong to a specific database file
		// and can never be copied between installs. A stale sidecar paired
		// with a healthy messages.db makes SQLite report "database disk image
		// is malformed" on open, which wipes the local chat history. Skip
		// them even when the destination DB exists (the normal upgrade case).
		if isSQLiteSidecar(entry.Name()) {
			stats.skipped++
			continue
		}

		if _, err := os.Lstat(dst); err == nil {
			stats.skipped++
			continue
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("migrate legacy config: inspect target %s: %w", entry.Name(), err)
		}

		// Lstat (not the DirEntry type) so symlinked directories are copied as
		// links instead of being traversed, which would risk a copy loop.
		info, err := os.Lstat(src)
		if err != nil {
			return fmt.Errorf("migrate legacy config: inspect %s: %w", entry.Name(), err)
		}

		switch {
		case info.IsDir():
			// Create writable first so a legacy read-only directory does not
			// block copying its own children; restore the stored mode afterwards.
			if err := os.Mkdir(dst, configDirPerm); err != nil {
				return fmt.Errorf("migrate legacy config: create directory %s: %w", entry.Name(), err)
			}
			stats.dirs++
			if err := copyLegacyTree(src, dst, stats); err != nil {
				return err
			}
			// Mkdir applies the process umask, so restore the stored mode.
			if err := os.Chmod(dst, info.Mode().Perm()); err != nil {
				return fmt.Errorf("migrate legacy config: chmod directory %s: %w", entry.Name(), err)
			}
		case info.Mode()&os.ModeSymlink != 0:
			target, err := os.Readlink(src)
			if err != nil {
				return fmt.Errorf("migrate legacy config: read link %s: %w", entry.Name(), err)
			}
			if err := os.Symlink(target, dst); err != nil {
				return fmt.Errorf("migrate legacy config: create link %s: %w", entry.Name(), err)
			}
			stats.links++
		case info.Mode().IsRegular():
			// Config files may hold session credentials. Tighten every copied
			// file to owner-only even if the legacy file was permissive; the
			// settings package's RestrictFile ran before migration existed.
			if err := copyLegacyFile(src, dst, secretFilePerm); err != nil {
				return err
			}
			stats.files++
		default:
			// Sockets, FIFOs and device nodes are not persisted config data.
			stats.skipped++
		}
	}
	return nil
}

// isSQLiteSidecar reports whether name is a transient SQLite journal file that
// must never be copied between config directories.
func isSQLiteSidecar(name string) bool {
	return strings.HasSuffix(name, "-wal") ||
		strings.HasSuffix(name, "-shm") ||
		strings.HasSuffix(name, "-journal")
}

// copyLegacyFile writes a single file with O_EXCL so even a race cannot
// overwrite an existing destination. A partially written copy is removed (only
// the new copy, never the legacy original) so a later startup can retry.
func copyLegacyFile(src, dst string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("migrate legacy config: open %s: %w", filepath.Base(src), err)
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return fmt.Errorf("migrate legacy config: create %s: %w", filepath.Base(dst), err)
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(dst)
		if copyErr != nil {
			return fmt.Errorf("migrate legacy config: copy %s: %w", filepath.Base(src), copyErr)
		}
		return fmt.Errorf("migrate legacy config: close %s: %w", filepath.Base(dst), closeErr)
	}
	if err := os.Chmod(dst, perm); err != nil {
		return fmt.Errorf("migrate legacy config: chmod %s: %w", filepath.Base(dst), err)
	}
	return nil
}
