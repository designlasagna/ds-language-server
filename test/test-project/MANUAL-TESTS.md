# Manual Test Files — DS Language Server

Open these files in Zed to manually test all LSP features.
Each file has numbered test scenarios with expected behavior in comments.

## Files

| File | Tests | Features |
|------|-------|----------|
| `manual-test.html` | 17 tests | All features in plain HTML |
| `manual-test.module.css` | 6 tests | Token completions + diagnostics in CSS modules |
| `manual-test.tsx` | 17 tests | All features in React/TSX (className, JSX) |
| `manual-test-lit.ts` | 7 tests | Tagged template literals (html\`\`, css\`\`) |

## Quick Feature Checklist

### Completions (Ctrl+Space / auto-trigger)
- [ ] Component tags: `<lfds-` → suggests lfds-button, lfds-shortcut
- [ ] Attributes: `<lfds-button ` → suggests variant, size, label⛔, slot...
- [ ] Attribute values: `variant="` → primary, secondary, tertiary⛔
- [ ] CSS tokens: `var(--lfds-` → 6 tokens with values
- [ ] Utility classes: `class="lf-` → 44 classes
- [ ] Slot values: `slot="` (inside lfds-button) → start, end

### Diagnostics (automatic squiggles)
- [ ] Deprecated token → ⚠️ warning with replacement + removal date
- [ ] Deprecated attribute value → ⚠️ "Use secondary instead"
- [ ] Deprecated attribute → ⚠️ "Use default slot instead"
- [ ] Draft component → ℹ️ info "draft status"

### Hover (mouse over)
- [ ] Token name → value, group, category, type
- [ ] Component tag → description, attributes, slots
- [ ] Attribute name → type, allowed values
- [ ] Utility class → description, category
- [ ] Slot value → slot description

### Code Actions (click 💡 on diagnostic)
- [ ] Replace `tertiary` → `secondary`
- [ ] Replace deprecated token → new token name

## Setup

Make sure your Zed settings have the server configured:
```json
{
  "lsp": {
    "ds-language-server": {
      "settings": {
        "serverPath": "~/Code/Private/ds-language-server/dist/server.js",
        "nodePath": "~/.nvm/versions/node/v22.20.0/bin/node"
      }
    }
  }
}
```

Then open this project folder in Zed. The LSP auto-discovers manifests from
`node_modules/@lansforsakringar/core-components` and `core-css`.
