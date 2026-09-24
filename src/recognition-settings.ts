import type { DSConfig } from './types.js';
import { templateRanges } from './template-regions.js';

export const DEFAULT_LANGUAGES: readonly string[] = [
  'html',
  'css',
  'scss',
  'less',
  'javascript',
  'typescript',
  'javascriptreact',
  'typescriptreact',
  'vue',
  'svelte',
  'astro',
];

export function isLanguageEnabled(languageId: string, config?: DSConfig): boolean {
  return (config?.languages ?? DEFAULT_LANGUAGES).includes(languageId);
}

export function classAttributes(config?: DSConfig): string[] {
  return config?.classAttributes ?? ['class', 'className', 'classList'];
}

export function maskRecognizedText(text: string, languageId: string, config?: DSConfig): string {
  const masked = text.replace(/[^\r\n]/g, ' ');
  if (!isLanguageEnabled(languageId, config)) return masked;
  if (languageId !== 'javascript' && languageId !== 'typescript') return text;
  const ranges = templateRanges(text, [
    ...(config?.templateTags?.html ?? ['html']),
    ...(config?.templateTags?.css ?? ['css']),
  ]);
  const chars = masked.split('');
  for (const range of ranges) {
    for (let i = range.start; i < range.end; i++) {
      chars[i] = text[i];
    }
  }
  return chars.join('');
}
