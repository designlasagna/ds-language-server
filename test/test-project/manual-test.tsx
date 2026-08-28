// @ts-nocheck
/* ═══════════════════════════════════════════════════════════════════
   MANUAL TEST: TSX / React — Design System Language Server
   ═══════════════════════════════════════════════════════════════════
   Open this file in Zed to test all features in JSX/TSX context.
*/

import styles from './manual-test.module.css';

export function ManualTestPage() {
  return (
    <main>
      {/* ─── TEST 1: Component tag completions ──────────────────────
          Type "<acme-" and trigger autocomplete.
          EXPECT: acme-button, acme-shortcut
      */}
      <acme-></acme->


      {/* ─── TEST 2: Attribute completions on component ─────────────
          Place cursor after "acme-button " and trigger.
          EXPECT: variant, size, type, href, disabled, label⛔, etc.
      */}
      <acme-button ></acme-button>


      {/* ─── TEST 3: Attribute VALUE completions ────────────────────
          Place cursor inside variant="" and trigger.
          EXPECT: primary, secondary, tertiary⛔
      */}
      <acme-button variant=""></acme-button>


      {/* ─── TEST 4: Deprecated value diagnostic + code action ──────
          EXPECT: ⚠️ on "tertiary"
          EXPECT: code action → replace with "secondary"
      */}
      <acme-button variant="tertiary">Bad value</acme-button>


      {/* ─── TEST 5: Deprecated attribute diagnostic ────────────────
          EXPECT: ⚠️ on "label" attribute
          EXPECT: message says "Use `default` slot instead"
      */}
      <acme-button label="Old way">Deprecated attr</acme-button>


      {/* ─── TEST 6: Valid usage — no warnings ──────────────────────
          EXPECT: clean, zero diagnostics
      */}
      <acme-button variant="primary" size="small">
        All good
      </acme-button>


      {/* ─── TEST 7: Slot value completions ─────────────────────────
          Place cursor inside slot="" and trigger.
          EXPECT: "start", "end"
      */}
      <acme-button variant="primary">
        <svg slot="">Icon</svg>
        Click
      </acme-button>


      {/* ─── TEST 8: Slot on acme-shortcut ──────────────────────────
          Place cursor inside slot="" and trigger.
          EXPECT: "description" (acme-shortcut slots)
      */}
      <acme-shortcut label="Help">
        <span slot="">Extra info</span>
      </acme-shortcut>


      {/* ─── TEST 9: Draft component info diagnostic ────────────────
          EXPECT: ℹ️ info on acme-shortcut (draft status)
      */}
      <acme-shortcut label="Draft warning"></acme-shortcut>


      {/* ─── TEST 10: className utility completions ─────────────────
          Place cursor after "acme-text-" and trigger.
          EXPECT: acme-text-heading-1 through heading-6, body-*, label-*, etc.
      */}
      <h1 className="acme-text-">Heading</h1>


      {/* ─── TEST 11: className with multiple classes ───────────────
          Place cursor after the space (second class position).
          EXPECT: all 44 utility classes suggested
      */}
      <p className="acme-text-body-default acme-">
        Body text with two classes
      </p>


      {/* ─── TEST 12: Utility completions — font weight ─────────────
          Type "acme-font-" and trigger.
          EXPECT: acme-font-weight-bold, acme-font-weight-light, etc.
      */}
      <span className="acme-font-">Bold text</span>


      {/* ─── TEST 13: CSS module + utility combo ────────────────────
          Both should work — module class from import + inline utility
          EXPECT: no diagnostics, valid usage
      */}
      <div className={`${styles.card} acme-text-body-default`}>
        Combined styles
      </div>


      {/* ─── TEST 14: Hover on component tag ────────────────────────
          Hover over "acme-button".
          EXPECT: component description, attributes, slots
      */}
      <acme-button variant="secondary">Hover me</acme-button>


      {/* ─── TEST 15: Hover on attribute name ───────────────────────
          Hover over "size".
          EXPECT: type info, allowed values (large | small)
      */}
      <acme-button size="large">Hover the attr</acme-button>


      {/* ─── TEST 16: Hover on utility class ────────────────────────
          Hover over "acme-text-heading-1".
          EXPECT: description, category
      */}
      <h1 className="acme-text-heading-1">Hover the class</h1>


      {/* ─── TEST 17: Hover on token in inline style ────────────────
          Hover over the token name.
          EXPECT: value (12px), group, category
      */}
      <div style={{ borderRadius: 'var(--acme-border-radius-md)' }}>
        Inline token
      </div>
    </main>
  );
}
