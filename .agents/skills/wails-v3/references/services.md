# Wails v3 services

Source: https://v3.wails.io/features/bindings/services/ and /features/bindings/methods/.

## Shape

A service is an ordinary Go struct. No embedded Wails context, no `startup(ctx)` method.

```go
type UserService struct {
    db     *sql.DB
    logger *slog.Logger
    mu     sync.RWMutex
}

func NewUserService(db *sql.DB, logger *slog.Logger) *UserService {
    return &UserService{db: db, logger: logger}
}

func (u *UserService) ServiceStartup(ctx context.Context, opts application.ServiceOptions) error {
    if err := u.db.Ping(); err != nil {
        return fmt.Errorf("db unavailable: %w", err)
    }
    return nil
}

func (u *UserService) ServiceShutdown() error { return u.db.Close() }

func (u *UserService) GetUser(id int) (*User, error) { /* ... */ }
```

Register with `application.NewService(NewUserService(db, logger))` in `application.Options.Services`, or `app.RegisterService(...)` afterwards.

## Rules

- Only **exported** methods are bound; services are **singletons** shared across windows — guard mutable state with `sync.RWMutex`.
- Constructor injection for dependencies; avoid globals. If a service needs the app, pass `app *application.App` explicitly after `application.New`.
- `ServiceStartup` runs in registration order and can abort startup; keep it fast. `ServiceShutdown` runs in reverse order.
- `ServiceOptions.Name` is a display name only; it does not change binding namespace. Register only one service per Go type; use distinct wrapper types for multiple instances.
- Return errors; never panic across a binding. Errors become rejected promises in JS; `error.cause` carries JSON of custom error types.
- `application.NewServiceWithOptions(svc, application.ServiceOptions{ MarshalError: ... })` controls error JSON; `Route: "/files"` exposes `http://wails.localhost/files/...`.
- Unsupported binding types: channels, funcs, complex interfaces, unexported struct fields. Use IDs/handles instead.

## Testing

Services are plain Go code — unit test them directly, mock dependencies (e.g. `sqlmock`), and test `ServiceStartup`/`ServiceShutdown` without launching the GUI. Add it to `tools/verify_central.ps1`-style gates: `go test ./...`.
