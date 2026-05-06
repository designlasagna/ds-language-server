# @ds-foundation/schemas

JSON schemas for design system manifests — tokens, utilities, and CEM extensions.

Used by the [DS Language Server](https://ds.foundation) for IntelliSense, diagnostics, and code actions. Also useful for CI validation and documentation tooling.

## Schemas

| Schema | Purpose |
|--------|---------|
| `v1/tokens.json` | Design token manifest (resolved values, modes, deprecation) |
| `v1/utilities.json` | CSS utility class manifest (categorized, with deprecation) |
| `v1/cem-extensions.json` | Extensions to CEM for lifecycle management |

## Usage

### In manifest files (`$schema`)

```json
{
  "$schema": "https://ds.foundation/schemas/v1/tokens.json",
  "schemaVersion": "1.0.0",
  "tokens": [...]
}
```

### CI validation

```bash
npm install @ds-foundation/schemas ajv-cli
ajv validate -s node_modules/@ds-foundation/schemas/v1/tokens.json -d dist/tokens.json
```

### Programmatic

```js
import tokenSchema from '@ds-foundation/schemas/v1/tokens.json' assert { type: 'json' };
import utilitySchema from '@ds-foundation/schemas/v1/utilities.json' assert { type: 'json' };
```

## Deprecation Object

All schemas share a unified deprecation shape:

```json
{
  "deprecated": {
    "message": "Use `--ds-color-primary-pressed` instead.",
    "removal": "2026-07-30",
    "replacement": "--ds-color-primary-pressed"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `message` | ✅ | Human-readable reason + migration guidance |
| `removal` | | When it will be removed (ISO date, semver, or quarter) |
| `replacement` | | Machine-readable replacement identifier |

## License

MIT
