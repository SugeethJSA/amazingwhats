# Wails v3 bindings

Source: https://v3.wails.io/features/bindings/methods/, /features/bindings/models/, /features/bindings/best-practices/, /contributing/architecture/bindings/.

## Generate

```sh
wails3 generate bindings        # JS in frontend/bindings
wails3 generate bindings -ts    # TypeScript with full types
wails3 generate bindings -d ./src/bindings
wails3 dev                      # regenerates on Go changes
```

Output is organised by service/module under `frontend/bindings/` (v2 used `frontend/wailsjs/go/<pkg>/<Struct>`). Use `wails3 generate bindings -names` for `$Call.ByName("<pkg>.<Struct>.<Method>")` instead of numeric IDs if you need stable symbolic calls.

## Import

```ts
import { GetUser } from './bindings/changeme/userservice'
const user = await GetUser(123)
```

or via index: `import { UserService } from './bindings/myapp'; await UserService.GetUser(123)`.

## Type mapping (key cases)

| Go | JS/TS |
|---|---|
| `string`, `bool`, numeric types | `string`, `boolean`, `number` |
| `[]T`, `[N]T` | `T[]` |
| `map[string]T` | `{ [key: string]: T }` |
| `[]byte` | `string` (base64) |
| `time.Time` | string (RFC3339Nano) or `Date` via `-time-type` |
| `*T` | `T \| null` |
| `any` | `any` |
| non-string map key | mapped type (not JS `Map`) |

## Errors

Go method errors reject the JS promise. Runtime throws `TypeError` (bad args), `RuntimeError` (Go returned error or panicked), or `Error` (unknown method). Use `Call.RuntimeError` from `@wailsio/runtime` to distinguish. Custom error types serialise into `error.cause` (exported fields only).

## Performance

Typical call < 1ms. Batch N calls into one method; cache on the Go side; use events for streams. Do not return channels/functions across the bridge.
