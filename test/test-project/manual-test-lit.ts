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
     Place cursor after "var(--acme-" and trigger.
     EXPECT (if supported): 6 token suggestions
  */
  static styles = css`
    :host {
      border-radius: var(--acme-);
      /* ↑ test here */
    }

    .deprecated {
      background: var(--acme-color-background-button-primary-pressed);
      /* EXPECT: editor-native deprecated token diagnostic */
    }

    .valid {
      border-radius: var(--acme-border-radius-md);
      padding: var(--acme-border-radius-sm);
      /* EXPECT: no warnings */
    }
  `;

  /* ─── TEST 2: html`` component completions ─────────────────────────
     Place cursor after "<acme-" and trigger.
     EXPECT (if supported): acme-button, acme-shortcut
  */
  render() {
    return html`
      <div class="acme-text-heading-1">
        <!-- TEST 3: class completions in html`` -->
        <!-- Place cursor after "acme-" and trigger -->
      </div>

      <acme-button variant="">
        <!-- TEST 4: attribute value completions -->
        <!-- Place cursor inside variant="" -->
        <span slot="">
          <!-- TEST 5: slot completions -->
        </span>
        Click me
      </acme-button>

      <!-- TEST 6: deprecated value in template -->
      <acme-button variant="tertiary">
        Bad value
      </acme-button>

      <!-- TEST 7: deprecated attribute in template -->
      <acme-button label="Old">
        Old attribute
      </acme-button>
    `;
  }
}
