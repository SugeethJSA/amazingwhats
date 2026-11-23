package settings

import (
	"reflect"
	"testing"
)

func TestToUpperSnakeCase(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"single word", "Debug", "DEBUG"},
		{"two words", "LogLevel", "LOG_LEVEL"},
		{"three words", "MyLongSetting", "MY_LONG_SETTING"},
		{"acronym", "HTTPServer", "HTTP_SERVER"},
		{"all caps", "URL", "URL"},
		{"leading lowercase", "someField", "SOME_FIELD"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := toUpperSnakeCase(tt.in); got != tt.want {
				t.Errorf("toUpperSnakeCase(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestSetupEnvVars(t *testing.T) {
	// t.Setenv mutates process-wide state, so these subtests are sequential.
	t.Run("known env keys populate matching fields", func(t *testing.T) {
		t.Setenv("DEBUG", "true")
		t.Setenv("LOG_LEVEL", "warn")

		c := _settings{}
		c.setupEnvVars()

		if !c.Debug {
			t.Error("Debug = false, want true")
		}
		if c.LogLevel != "warn" {
			t.Errorf("LogLevel = %q, want %q", c.LogLevel, "warn")
		}
	})

	t.Run("false and empty values overwrite stale fields", func(t *testing.T) {
		t.Setenv("DEBUG", "false")
		t.Setenv("LOG_LEVEL", "")

		c := _settings{Debug: true, LogLevel: "stale"}
		c.setupEnvVars()

		if c.Debug {
			t.Error("Debug = true, want false")
		}
		if c.LogLevel != "" {
			t.Errorf("LogLevel = %q, want empty", c.LogLevel)
		}
	})

	t.Run("invalid bool falls back to false", func(t *testing.T) {
		t.Setenv("DEBUG", "not-a-bool")
		t.Setenv("LOG_LEVEL", "INFO")

		c := _settings{Debug: true}
		c.setupEnvVars()

		if c.Debug {
			t.Error("Debug = true after invalid value, want false")
		}
	})
}

func TestEnvKeysDerivedOnlyFromFields(t *testing.T) {
	// The loader derives env var names from struct fields only; it must not
	// consult or invent any other configuration key.
	t.Setenv("UNRELATED_KEY", "value")
	t.Setenv("DEBUG", "false")
	t.Setenv("LOG_LEVEL", "INFO")

	typ := reflect.TypeOf(_settings{})
	got := make(map[string]bool, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		got[toUpperSnakeCase(typ.Field(i).Name)] = true
	}
	want := map[string]bool{"DEBUG": true, "LOG_LEVEL": true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("derived env keys = %v, want %v", got, want)
	}

	c := _settings{}
	c.setupEnvVars()
	if c.Debug {
		t.Error("Debug changed due to an unrelated env key")
	}
	if c.LogLevel != "INFO" {
		t.Errorf("LogLevel = %q, want INFO", c.LogLevel)
	}
}
