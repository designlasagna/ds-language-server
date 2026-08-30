import { Hover, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { DSStore } from '../store.js';
import { tryVarHover } from './hover/variable.js';
import { tryClassHover } from './hover/class.js';
import { tryTagHover } from './hover/tag.js';
import { tryAttrValueHover } from './hover/attribute-value.js';
import { trySlotValueHover } from './hover/slot-value.js';
import { tryAttrHover } from './hover/attribute.js';

/**
 * Provide hover information at a cursor position.
 */
export function getHover(
  document: TextDocument,
  position: Position,
  store: DSStore,
): Hover | null {
  const offset = document.offsetAt(position);
  const text = document.getText();

  // ── Try CSS var() hover ────────────────────────────────────────
  const varHover = tryVarHover(text, offset, store);
  if (varHover) return varHover;

  // ── Try class name hover ───────────────────────────────────────
  const classHover = tryClassHover(text, offset, store);
  if (classHover) return classHover;

  // ── Try HTML tag hover ─────────────────────────────────────────
  const tagHover = tryTagHover(text, offset, store);
  if (tagHover) return tagHover;

  // ── Try HTML attribute value hover ─────────────────────────────
  const attrValueHover = tryAttrValueHover(text, offset, store);
  if (attrValueHover) return attrValueHover;

  // ── Try slot attribute value hover ─────────────────────────────
  const slotHover = trySlotValueHover(text, offset, store);
  if (slotHover) return slotHover;

  // ── Try HTML attribute hover ───────────────────────────────────
  const attrHover = tryAttrHover(text, offset, store);
  if (attrHover) return attrHover;

  return null;
}
