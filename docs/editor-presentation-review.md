# Editor Presentation Review

**Scope:** editor-facing output only: completion items, hover cards, diagnostics, and code actions. This review does not change recognition behavior or introduce parsing changes.

## Executive summary

The language server already has good coverage across HTML, JSX, CSS, classes, slots, and token documents. Its main presentation weakness is inconsistency: completions often contain richer information than hover; deprecated items intentionally lose hover entirely; and schema errors expose raw AJV wording. The most valuable next change is a small shared presentation layer, not new data sources.

## Current strengths

- Context-specific completion and hover providers keep LSP dispatch behavior clear.
- Completion uses LSP kinds, snippets, deprecation tags, and meaningful detail for most contexts.
- CSS-variable completion and hover show resolved mode values, metadata, and package provenance.
- Lifecycle diagnostics carry exact ranges, severity escalation, deprecation tags, and replacement quick fixes.
- Token schema diagnostics are restricted to declared token documents and use JSONC-aware source ranges.

## Findings and recommendations

### P1 — Keep deprecation information available on hover

**Observed:** token, utility, attribute, and attribute-value hovers return `null` when the item is deprecated, because a diagnostic is expected to carry the message.

**Why it matters:** users frequently discover API information by hovering; a diagnostic can be hidden, filtered, or located elsewhere in the line. The current behavior makes the most important lifecycle information unavailable in the hover channel and makes deprecation presentation differ by entity (components still show it).

**Recommendation:** keep the normal hover card and prepend a compact, shared deprecation callout: status, replacement, and removal timing. Do not duplicate the full diagnostic prose. Retain the diagnostic and quick fix as the action path.

**Boundary/tests:** extract a shared lifecycle callout formatter; test one deprecated token, utility, attribute, and attribute value for equivalent callout content.

### P1 — Make schema errors human-oriented and target missing properties precisely

**Observed:** schema diagnostics render raw AJV text such as `"/ must have required property 'tokens'"`. For a missing property the JSON Pointer is empty, so the range is the whole document.

**Why it matters:** the raw pointer and AJV grammar add cognitive work; whole-document squiggles are imprecise in an editor.

**Recommendation:** translate common AJV errors into concise messages (for example, `Missing required property: tokens`) and target the containing object/property insertion location for `required` errors. Keep the schema identifier/code for tooling.

**Boundary/tests:** leave validation semantics unchanged; add exact-range and message assertions for required, type, enum/additional-property, and malformed JSON cases.

### P1 — Present the actual JSX component name consistently

**Observed:** when a PascalCase CEM `className` is completed, the label and inserted snippet use the class name, but the documentation heading still presents the hyphenated custom-element tag.

**Why it matters:** React-wrapper users see documentation for a different spelling than the item they selected.

**Recommendation:** pass the selected presentation name into component documentation and show the alternate form explicitly when both are available, e.g. `AcmeButton` with `Custom element: <acme-button>`.

**Boundary/tests:** preserve lookup/recognition precedence; add a JSX completion snapshot asserting label, snippet, and documentation agree.

### P2 — Guarantee a useful completion card even when descriptions are absent

**Observed:** attribute and utility completion documentation is omitted when `description` is absent. Attributes can still have high-value type, default, enum, lifecycle, or related-token data.

**Why it matters:** sparse manifests produce a blank details panel even though structured data is available.

**Recommendation:** generate documentation whenever any presentable metadata exists. Use a single compact field order: description, type/value, default, allowed values, status/lifecycle, provenance.

**Boundary/tests:** reuse a shared Markdown field formatter where practical. Cover a description-less enum/default attribute and a description-less categorized utility.

### P2 — Standardize information hierarchy and provenance

**Observed:** cards use similar fields but in different orders; package provenance appears in component/token/utility hovers but not attributes, slot values, or completion documentation. Status uses an emoji in some places and text only in others.

**Recommendation:** establish one hierarchy:

1. identity and kind;
2. one-line description;
3. current value/type/default;
4. allowed values or related entities;
5. lifecycle callout;
6. source package.

Use text as the semantic signal (`Deprecated`, `Draft`, `Beta`) and treat emoji as optional decoration rather than the only indicator.

### P2 — Make completion ordering deterministic and intentional

**Observed:** active items use the same `!` sort prefix and deprecated items `~`; order within either group depends on manifest/store iteration.

**Why it matters:** completion order can change as manifest input order changes, which makes common items harder to find and tests less stable.

**Recommendation:** retain active-before-deprecated ordering, then add a normalized name to `sortText`. If a default attribute value is intentionally preferred, define that explicitly instead of relying on input order.

### P3 — Refine compact details and snippets

- Attribute completion details can become very wide for large enum sets; show a type or value count in `detail` and keep the full list in documentation.
- Token mode values are rendered inline with middle dots; use a Markdown table or line-per-mode once there are more than two modes.
- Named-slot completion documentation should include the parent component and its source package, consistent with slot hover.
- Consider adding an explicit `triggerCharacters`/client behavior review for `--`, `=`, and space; this belongs in editor adapters rather than core provider output.

## Recommended implementation sequence

1. **P1 deprecation hover callout** — high user value; shared formatter with low behavior risk.
2. **P1 schema diagnostic phrasing/ranges** — high clarity for token authors; isolated provider tests.
3. **P1 JSX name consistency** — small focused completion change.
4. **P2 shared documentation hierarchy and deterministic ordering** — consolidate after the P1 behavior is characterized.
5. **P3 density/snippet refinements** — validate manually in VS Code and Zed before committing to a format.

## Manual review checklist

Validate each change in both VS Code and Zed against the manual fixtures:

- HTML and JSX component completion; confirm label, snippet, and documentation spell the selected API correctly.
- Deprecated token, utility, attribute, and enum value; confirm hover, diagnostic, and quick fix agree on replacement/removal.
- An invalid DTCG document and invalid Design Lasagna manifest; confirm messages are readable and squiggles target the smallest useful range.
- Long enum attribute and multi-mode token; confirm cards remain scannable without losing detail.
