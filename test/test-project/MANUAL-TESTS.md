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
- [ ] Component tags: `<acme-` → suggests acme-button, acme-shortcut
- [ ] Attributes: `<acme-button ` → suggests variant, size, deprecated `label`, slot...
- [ ] Attribute values: `variant="` → primary, secondary, deprecated `tertiary`
- [ ] CSS tokens: `var(--acme-` → 6 tokens with values
- [ ] Utility classes: `class="acme-` → 44 classes
- [ ] Slot values: `slot="` (inside acme-button) → start, end

### Diagnostics (automatic squiggles)
- [ ] Deprecated token → editor-native warning/error with replacement + removal date
- [ ] Deprecated attribute value → editor-native warning/error: "Use secondary instead"
- [ ] Deprecated attribute → editor-native warning/error: "Use default slot instead"
- [ ] Draft component → editor-native information diagnostic: "draft status"

### Hover (mouse over)
- [ ] Token name → value, group, category, type
- [ ] Component tag → description, attributes, slots
- [ ] Attribute name → type, allowed values
- [ ] Utility class → description, category
- [ ] Slot value → slot description

### Code Actions (from the editor diagnostic menu)
- [ ] Replace `tertiary` → `secondary`
- [ ] Replace deprecated token → new token name

## Setup

Build the server from the repository root:
```bash
npm run build
```

Then open this project folder in Zed. Its `.zed/settings.json` starts the local
`../../dist/server.js`, and `ds.config.json` loads the neutral manifests in
`manifests/`. No dependency installation or package discovery is required.
