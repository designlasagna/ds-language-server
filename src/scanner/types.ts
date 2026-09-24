export interface DocumentSymbol {
  kind: 'tag' | 'attribute' | 'attribute-value' | 'css-var' | 'class';
  name: string;
  start: number;
  end: number;
  tagName?: string;
  attributeName?: string;
}

export interface CursorContext {
  kind: 'tag-open' | 'attribute-name' | 'attribute-value' | 'css-var' | 'css-part' | 'class-value' | 'property-name' | 'event-name' | 'none';
  prefix: string;
  tagName?: string;
  attributeName?: string;
  parentTagName?: string;
}
