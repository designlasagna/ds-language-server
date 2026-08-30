/** Public scanner facade; internals are split by concern in ./scanner/. */
export { getCursorContext } from './scanner/context.js';
export { scanDocument } from './scanner/symbols.js';
export type { CursorContext, DocumentSymbol } from './scanner/types.js';
