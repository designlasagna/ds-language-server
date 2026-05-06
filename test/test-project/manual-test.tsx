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
          Type "<lfds-" and trigger autocomplete.
          EXPECT: lfds-button, lfds-shortcut
      */}
      <lfds-></lfds->


      {/* ─── TEST 2: Attribute completions on component ─────────────
          Place cursor after "lfds-button " and trigger.
          EXPECT: variant, size, type, href, disabled, label⛔, etc.
      */}
      <lfds-button ></lfds-button>


      {/* ─── TEST 3: Attribute VALUE completions ────────────────────
          Place cursor inside variant="" and trigger.
          EXPECT: primary, secondary, tertiary⛔
      */}
      <lfds-button variant=""></lfds-button>


      {/* ─── TEST 4: Deprecated value diagnostic + code action ──────
          EXPECT: ⚠️ on "tertiary"
          EXPECT: code action → replace with "secondary"
      */}
      <lfds-button variant="tertiary">Bad value</lfds-button>


      {/* ─── TEST 5: Deprecated attribute diagnostic ────────────────
          EXPECT: ⚠️ on "label" attribute
          EXPECT: message says "Use `default` slot instead"
      */}
      <lfds-button label="Old way">Deprecated attr</lfds-button>


      {/* ─── TEST 6: Valid usage — no warnings ──────────────────────
          EXPECT: clean, zero diagnostics
      */}
      <lfds-button variant="primary" size="small">
        All good
      </lfds-button>


      {/* ─── TEST 7: Slot value completions ─────────────────────────
          Place cursor inside slot="" and trigger.
          EXPECT: "start", "end"
      */}
      <lfds-button variant="primary">
        <svg slot="">Icon</svg>
        Click
      </lfds-button>


      {/* ─── TEST 8: Slot on lfds-shortcut ──────────────────────────
          Place cursor inside slot="" and trigger.
          EXPECT: "description" (lfds-shortcut slots)
      */}
      <lfds-shortcut label="Help">
        <span slot="">Extra info</span>
      </lfds-shortcut>


      {/* ─── TEST 9: Draft component info diagnostic ────────────────
          EXPECT: ℹ️ info on lfds-shortcut (draft status)
      */}
      <lfds-shortcut label="Draft warning"></lfds-shortcut>


      {/* ─── TEST 10: className utility completions ─────────────────
          Place cursor after "lf-text-" and trigger.
          EXPECT: lf-text-heading-1 through heading-6, body-*, label-*, etc.
      */}
      <h1 className="lf-text-">Heading</h1>


      {/* ─── TEST 11: className with multiple classes ───────────────
          Place cursor after the space (second class position).
          EXPECT: all 44 utility classes suggested
      */}
      <p className="lf-text-body-default lf-">
        Body text with two classes
      </p>


      {/* ─── TEST 12: Utility completions — font weight ─────────────
          Type "lf-font-" and trigger.
          EXPECT: lf-font-weight-bold, lf-font-weight-light, etc.
      */}
      <span className="lf-font-">Bold text</span>


      {/* ─── TEST 13: CSS module + utility combo ────────────────────
          Both should work — module class from import + inline utility
          EXPECT: no diagnostics, valid usage
      */}
      <div className={`${styles.card} lf-text-body-default`}>
        Combined styles
      </div>


      {/* ─── TEST 14: Hover on component tag ────────────────────────
          Hover over "lfds-button".
          EXPECT: component description, attributes, slots
      */}
      <lfds-button variant="secondary">Hover me</lfds-button>


      {/* ─── TEST 15: Hover on attribute name ───────────────────────
          Hover over "size".
          EXPECT: type info, allowed values (large | small)
      */}
      <lfds-button size="large">Hover the attr</lfds-button>


      {/* ─── TEST 16: Hover on utility class ────────────────────────
          Hover over "lf-text-heading-1".
          EXPECT: description, category
      */}
      <h1 className="lf-text-heading-1">Hover the class</h1>


      {/* ─── TEST 17: Hover on token in inline style ────────────────
          Hover over the token name.
          EXPECT: value (12px), group, category
      */}
      <div style={{ borderRadius: 'var(--lfds-border-radius-md)' }}>
        Inline token
      </div>
    </main>
  );
}
