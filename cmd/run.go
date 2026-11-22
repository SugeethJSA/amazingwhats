package cmd

import (
	"io/fs"
	"net/http"
	"strings"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/server"
	"github.com/lugvitc/whats4linux/internal/tray"
	"github.com/urfave/cli"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// assetHandler keeps the /cached-image/ route (and its path-traversal guard)
// in front of the embedded frontend assets. In v2 this was the AssetServer
// fallback Handler; in v3 Assets.Handler serves every request, so the two
// handlers are composed explicitly here.
func assetHandler(assets fs.FS) http.Handler {
	files := application.AssetFileServerFS(assets)
	cachedImages := server.NewAssetFileServer()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/cached-image/") {
			cachedImages.ServeHTTP(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func run(assets fs.FS) cli.ActionFunc {
	return func(_ *cli.Context) error {
		// v3 service lifecycle: the Api service loads and closes the settings
		// file in ServiceStartup / ServiceShutdown so the handle stays open for
		// the whole application lifetime.

		// The second-instance callback is installed before the window exists;
		// capture the variable and guard against an early notification.
		var window *application.WebviewWindow
		var systray *tray.Tray

		app := application.New(application.Options{
			Name:        misc.AppName,
			Description: "An unofficial WhatsApp client.",
			OnShutdown: func() {
				systray.Destroy()
			},
			Assets: application.AssetOptions{
				Handler: assetHandler(assets),
			},
			SingleInstance: &application.SingleInstanceOptions{
				UniqueID: misc.AppID,
				OnSecondInstanceLaunch: func(_ application.SecondInstanceData) {
					if window == nil {
						return
					}
					window.UnMinimise()
					window.Show()
					window.Focus()
				},
			},
			// Closing the window keeps the app alive in the tray so Open can
			// restore it (v2 behaviour via the external systray process).
			// v3 exposes this per platform, not on application.Options.
			Windows: application.WindowsOptions{
				DisableQuitOnLastWindowClosed: true,
			},
			Mac: application.MacOptions{
				ApplicationShouldTerminateAfterLastWindowClosed: false,
			},
			Linux: application.LinuxOptions{
				ProgramName:                   misc.AppName,
				DisableQuitOnLastWindowClosed: true,
			},
		})

		window = app.Window.NewWithOptions(application.WebviewWindowOptions{
			Title:  misc.AppName,
			Width:  1024,
			Height: 768,
			// A:1 is preserved byte-for-byte from the v2 RGBA option.
			BackgroundColour: application.NewRGBA(27, 38, 54, 1),
			Linux: application.LinuxWindow{
				WindowIsTranslucent: false,
				// Software rendering avoids WebKitGTK GPU-process crashes across
				// mixed Mesa/NVIDIA/Wayland setups.
				WebviewGpuPolicy: application.WebviewGpuPolicyNever,
			},
		})

		api := apiPkg.New(app, window)
		app.RegisterService(application.NewService(api))

		// The tray lives in-process now; build it once the window and service
		// exist so every menu action has a target.
		systray = tray.New(app, window, api)

		return app.Run()
	}
}
