import * as fs from 'node:fs';
import type {
  DSComponent,
  DSToken,
  DSUtilityClass,
  ManifestSources,
} from './types.js';
import { parseCEM } from './parsers/cem.js';
import { parseTokens } from './parsers/tokens.js';
import { parseUtilities } from './parsers/utilities.js';

/**
 * Central data store for all design system data.
 * Loaded from discovered manifests, queried by providers.
 */
export class DSStore {
  private components: DSComponent[] = [];
  private tokens: DSToken[] = [];
  private utilities: DSUtilityClass[] = [];

  // Lookup indices
  private componentsByTag = new Map<string, DSComponent>();
  private tokensByName = new Map<string, DSToken>();
  private utilitiesByName = new Map<string, DSUtilityClass>();

  /**
   * Load all data from discovered manifest files.
   */
  load(sources: ManifestSources): void {
    this.components = [];
    this.tokens = [];
    this.utilities = [];

    // Parse components from CEM files
    for (const file of sources.components) {
      try {
        const raw = fs.readFileSync(file.path, 'utf-8');
        const json = JSON.parse(raw);
        const parsed = parseCEM(json, file.packageName);
        this.components.push(...parsed);
      } catch (e) {
        console.error(`[ds-ls] Failed to parse CEM: ${file.path}`, e);
      }
    }

    // Parse tokens
    for (const file of sources.tokens) {
      try {
        const raw = fs.readFileSync(file.path, 'utf-8');
        const json = JSON.parse(raw);
        const parsed = parseTokens(json, file.packageName);
        this.tokens.push(...parsed);
      } catch (e) {
        console.error(`[ds-ls] Failed to parse tokens: ${file.path}`, e);
      }
    }

    // Parse utilities
    for (const file of sources.utilities) {
      try {
        const raw = fs.readFileSync(file.path, 'utf-8');
        const json = JSON.parse(raw);
        const parsed = parseUtilities(json, file.packageName);
        this.utilities.push(...parsed);
      } catch (e) {
        console.error(`[ds-ls] Failed to parse utilities: ${file.path}`, e);
      }
    }

    // Build indices
    this.buildIndices();

    console.error(
      `[ds-ls] Loaded ${this.components.length} components, ` +
      `${this.tokens.length} tokens, ${this.utilities.length} utilities`,
    );
  }

  private buildIndices(): void {
    this.componentsByTag.clear();
    this.tokensByName.clear();
    this.utilitiesByName.clear();

    for (const c of this.components) {
      this.componentsByTag.set(c.tagName, c);
    }
    for (const t of this.tokens) {
      this.tokensByName.set(t.name, t);
    }
    for (const u of this.utilities) {
      this.utilitiesByName.set(u.name, u);
    }
  }

  // ─── Query methods ──────────────────────────────────────────────

  getComponents(): readonly DSComponent[] {
    return this.components;
  }

  getComponent(tagName: string): DSComponent | undefined {
    return this.componentsByTag.get(tagName);
  }

  getTokens(): readonly DSToken[] {
    return this.tokens;
  }

  getToken(name: string): DSToken | undefined {
    return this.tokensByName.get(name);
  }

  getUtilities(): readonly DSUtilityClass[] {
    return this.utilities;
  }

  getUtility(name: string): DSUtilityClass | undefined {
    return this.utilitiesByName.get(name);
  }

  /**
   * Check if a tag name belongs to a known component.
   */
  isComponent(tagName: string): boolean {
    return this.componentsByTag.has(tagName);
  }

  /**
   * Check if a CSS variable belongs to a known token.
   */
  isToken(varName: string): boolean {
    return this.tokensByName.has(varName);
  }

  /**
   * Check if a class name belongs to a known utility.
   */
  isUtility(className: string): boolean {
    return this.utilitiesByName.has(className);
  }

  /**
   * Return summary stats.
   */
  stats(): { components: number; tokens: number; utilities: number } {
    return {
      components: this.components.length,
      tokens: this.tokens.length,
      utilities: this.utilities.length,
    };
  }
}
