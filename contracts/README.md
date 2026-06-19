# contracts

`openapi.yaml` is the single source of truth for the HTTP API between the React debug client and the Express bridge server.

## Consuming

Both subprojects codegen from this file. Run from either subproject:

```bash
pnpm contracts:generate
```

This invokes `@hey-api/openapi-ts` pointed at `../contracts/openapi.yaml` and writes generated output to `src/gen/`.

The generated `src/gen/` folders are committed, so a fresh clone works without running `pnpm contracts:generate`. Re-run it whenever you change this YAML.

## Generated artefacts

| Subproject | Generated file(s) | Contents |
|---|---|---|
| `bridge/` | `src/gen/types.gen.ts` | TypeScript interfaces for all schemas |
| `bridge/` | `src/gen/zod.gen.ts` | Zod schemas for request/response validation |
| `client/` | `src/gen/types.gen.ts` | TypeScript interfaces |
| `client/` | `src/gen/sdk.gen.ts` | Typed fetch functions per operation |

## Adding or changing an endpoint

1. Edit `openapi.yaml`.
2. Run `pnpm contracts:generate` in both `bridge/` and `client/`.
3. Fix any resulting TypeScript errors — they are the spec-drift detector.
