import type { Adapter } from './adapter.js';
import type { CodemapConfig } from './config.js';
import type { EndpointSeg } from './match/url.js';
import type { FrameworkId, Side } from './types.js';

/**
 * A framework the analyzer supports, on one side of the map: what the pipeline, project detection and the link
 * stage need to know about it. Everything else (parsing, extraction, routes) lives in its adapter, under
 * src/lang/<language>/. To add a framework, implement this next to its adapter and register it in
 * src/frameworks.ts; docs/ARCHITECTURE.md walks through it.
 */
export interface Framework {
  /** Stable id: the `server` of its endpoints in graph.json and the key of its section in the config file. */
  readonly id: FrameworkId;
  /** Display name ("Laravel"). */
  readonly name: string;
  /** The language of its source files, as shown in the viewer ("PHP", "JS/TS"). */
  readonly language: string;
  readonly side: Side;
  /** What makes a folder a project of this framework, as shown in messages ("composer.json + artisan"). */
  readonly marker: string;
  /** Is `dir` the root of a project of this framework? Cheap: monorepo detection calls it on many folders. */
  isRoot(dir: string): boolean;
  /** Warnings about a root that was given explicitly (it may not be a project of this framework). */
  checkRoot(dir: string): string[];
  /**
   * Glob patterns (relative to the root) the scan skips, from the config. The pipeline appends to this list to keep
   * a project nested in the other side's root apart from it.
   */
  exclude(config: CodemapConfig): string[];
  createAdapter(root: string, config: CodemapConfig, warnings: string[], options: { keepSyntax?: boolean }): Adapter;
  /** An endpoint path as the framework writes it ("/users/{id}", "/users/[id]") -> URL pattern for the link stage. */
  endpointPattern(path: string): EndpointSeg[];
}
