package api

import "testing"

// TestNormalizeUpdateVersion covers the pure version normalization used to
// derive updater.Config.CurrentVersion. No network, filesystem or Wails
// runtime is involved.
func TestNormalizeUpdateVersion(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		// Known build-type suffixes are stripped.
		{"dev default with build type", "0.0.0-unclassified", "0.0.0"},
		{"dev default bare", "0.0.0", "0.0.0"},
		{"dev identifier bare", "dev", "0.0.0"},
		{"dev identifier with build type", "dev-unclassified", "0.0.0"},
		{"release build", "1.2.3-release", "1.2.3"},
		{"snapshot build", "1.2.3-snapshot", "1.2.3"},
		{"debug build", "1.2.3-debug", "1.2.3"},
		{"production build", "1.4.0-production", "1.4.0"},
		{"v prefixed nightly", "v1.0.0-nightly", "1.0.0"},
		{"v prefixed release", "v1.2.3-release", "1.2.3"},

		// Prerelease tags are part of the version and must survive.
		{"prerelease with build type", "1.2.3-beta.1-release", "1.2.3-beta.1"},
		{"prerelease bare", "1.2.3-beta.1", "1.2.3-beta.1"},
		{"v prefixed prerelease with build type", "v1.2.3-rc.1-nightly", "1.2.3-rc.1"},
		{"prerelease with unknown suffix", "1.2.3-beta.1-canary", "1.2.3-beta.1-canary"},

		// Unknown build-type suffixes are not build types at all, so kept.
		{"unknown build type", "1.2.3-canary", "1.2.3-canary"},
		{"v prefixed unknown build type", "v2.0.0-canary", "2.0.0-canary"},

		{"bare version", "2.0.0", "2.0.0"},
		{"empty", "", "0.0.0"},
		{"whitespace", "  1.2.3-release  ", "1.2.3"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeUpdateVersion(tt.in); got != tt.want {
				t.Fatalf("NormalizeUpdateVersion(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
