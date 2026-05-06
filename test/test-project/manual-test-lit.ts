// @ts-nocheck
/* ═══════════════════════════════════════════════════════════════════
   MANUAL TEST: Lit Web Component — Design System Language Server
   ═══════════════════════════════════════════════════════════════════
   Tests html`` and css`` tagged template literals.
   NOTE: Template literal support may not be implemented yet —
   this file documents expected behavior for future work.
*/

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('my-card')
export class MyCard extends LitElement {

  /* ─── TEST 1: css`` token completions ──────────────────────────────
     Place cursor after "var(--lfds-" and trigger.
     EXPECT (if supported): 6 token suggestions
  */
  static styles = css`
    :host {
      border-radius: var(--lfds-);
      /* ↑ test here */
    }

    .deprecated {
      background: var(--lfds-color-background-button-primary-pressed);
      /* EXPECT: ⚠️ deprecated token diagnostic */
    }

    .valid {
      border-radius: var(--lfds-border-radius-md);
      padding: var(--lfds-border-radius-sm);
      /* EXPECT: no warnings */
    }
  `;

  /* ─── TEST 2: html`` component completions ─────────────────────────
     Place cursor after "<lfds-" and trigger.
     EXPECT (if supported): lfds-button, lfds-shortcut
  */
  render() {
    return html`
      <div class="lf-text-heading-1">
        <!-- TEST 3: class completions in html`` -->
        <!-- Place cursor after "lf-" and trigger -->
      </div>

      <lfds-button variant="">
        <!-- TEST 4: attribute value completions -->
        <!-- Place cursor inside variant="" -->
        <span slot="">
          <!-- TEST 5: slot completions -->
        </span>
        Click me
      </lfds-button>

      <!-- TEST 6: deprecated value in template -->
      <lfds-button variant="tertiary">
        Bad value
      </lfds-button>

      <!-- TEST 7: deprecated attribute in template -->
      <lfds-button label="Old">
        Old attribute
      </lfds-button>
    `;
  }
}
