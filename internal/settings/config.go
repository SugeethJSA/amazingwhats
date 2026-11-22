package settings

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"

	"github.com/lugvitc/whats4linux/internal/misc"
)

type _settings struct {
	Debug    bool   `json:"debug"`
	LogLevel string `json:"log_level"`
}

var s _settings

func init() {
	defer s.setupEnvVars()

	// Migrate config files written by older versions with permissive modes.
	for _, name := range []string{"settings.json", "custom.css", "custom.js"} {
		misc.RestrictFile(filepath.Join(misc.ConfigDir, name))
	}

	path := filepath.Join(misc.ConfigDir, "settings.json")
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	// Unmarshal into a temporary value so a malformed file cannot leave the
	// global settings partially overwritten.
	var loaded _settings
	if err := json.Unmarshal(b, &loaded); err != nil {
		log.Printf("settings: malformed %s, ignoring: %v", path, err)
		return
	}
	s = loaded
}

func (c *_settings) GetDebug() bool {
	return c.Debug
}

func GetLogLevel() string {
	if s.Debug {
		return "DEBUG"
	}
	if s.LogLevel == "" {
		return "INFO"
	}
	return s.LogLevel
}

func GetCustomCSS() string {
	b, err := os.ReadFile(
		filepath.Join(misc.ConfigDir, "custom.css"),
	)
	if err != nil {
		return ""
	}
	return string(b)
}

func SetCustomCSS(css string) error {
	path := filepath.Join(misc.ConfigDir, "custom.css")
	if err := os.WriteFile(path, []byte(css), 0600); err != nil {
		return err
	}
	misc.RestrictFile(path) // migrate an existing permissive file
	return nil
}

func GetCustomJS() string {
	b, err := os.ReadFile(
		filepath.Join(misc.ConfigDir, "custom.js"),
	)
	if err != nil {
		return ""
	}
	return string(b)
}

func SetCustomJS(js string) error {
	path := filepath.Join(misc.ConfigDir, "custom.js")
	if err := os.WriteFile(path, []byte(js), 0600); err != nil {
		return err
	}
	misc.RestrictFile(path) // migrate an existing permissive file
	return nil
}
