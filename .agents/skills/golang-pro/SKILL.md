---
name: golang-pro
description: Router for Go backend work in Wails apps — concurrency, error handling, testing, security, performance and project layout. Defers to the installed samber/cc-skills-golang and spf13/go-skills catalogs instead of duplicating their content.
---

# golang-pro (router)

Do not duplicate the installed Go catalogs. Pick the matching installed skill and follow it:

- Idiomatic Go / project layout / Go 1.27: `go` (spf13) and `golang-code-style`, `golang-project-layout`, `golang-modernize` (samber).
- Concurrency / context / channels: `golang-concurrency`, `golang-context`.
- Errors: `golang-error-handling`.
- Testing / fuzzing / testify: `golang-testing`, `golang-stretchr-testify`.
- Troubleshooting / pprof / Delve / race: `golang-troubleshooting`, `golang-benchmark`, `golang-gopls`.
- Security / crypto / input: `golang-security`, `golang-safety`.
- Database / SQLite: `golang-database`.
- Dependencies / CI / lint: `golang-dependency-management`, `golang-continuous-integration`, `golang-lint`.
- Logging / observability: `golang-observability`, `golang-samber-slog`.

Workflow: load the relevant skill, apply it to the Wails service/backend code, then verify with `go build ./...`, `go vet ./...`, `go test ./...` (and `-race` where relevant). Never run builds from a swarm worker — the mother owns the single verifier.
