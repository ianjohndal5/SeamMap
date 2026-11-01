import type { GraphBuilder } from './graph.js';
import { matchCall, type PatternedEndpoint } from './match/match.js';
import type { Framework } from './framework.js';
import { frameworkById } from './frameworks.js';
import { normalizeCallUrl, type NormalizeOptions } from './match/url.js';
import type { Endpoint, HttpCall, UnmatchedHttpCall } from './types.js';

export interface LinkResult {
  matchedCalls: number;
  unmatchedCalls: UnmatchedHttpCall[];
  unmatchedEndpoints: string[];
}

const DYNAMIC_ID = 'unmatched:dynamic';

/**
 * The framework analyzed on each side, or null. Without a backend nothing can match it, without a frontend nothing
 * calls the endpoints.
 */
export interface Sides {
  backend: Framework | null;
  frontend: Framework | null;
}

/**
 * Link stage: normalize every frontend HTTP call, match it against the endpoints (the backend's routes, and the
 * frontend's own route handlers), and emit `http` edges. Calls that match nothing point at an "unmatched"
 * pseudo-endpoint so they stay visible in the middle column.
 */
export function link(graph: GraphBuilder, calls: HttpCall[], endpoints: Endpoint[], opts: NormalizeOptions, sides: Sides): LinkResult {
  const backend: PatternedEndpoint[] = [];
  const own: PatternedEndpoint[] = [];
  for (const ep of endpoints) {
    const framework = frameworkById(ep.server);
    if (!framework) throw new Error(`endpoint ${ep.id}: unknown framework "${ep.server}"`);
    (framework.side === 'backend' ? backend : own).push({ ...ep, segs: framework.endpointPattern(ep.path) });
  }
  const backendRoutes = sides.backend ? `${sides.backend.name} route` : null;
  const ownRoutes = `${sides.frontend?.name ?? 'frontend'} route handler`;
  const called = new Set<string>();
  const unmatchedCalls: UnmatchedHttpCall[] = [];
  let matchedCalls = 0;
  // An env var has one value at runtime: a base path inferred from a fallback anywhere applies to all its uses.
  const inferred = new Map<string, Set<string>>();
  for (const call of calls) {
    for (const part of call.url) {
      if (part.t !== 'env' || part.basePath === undefined) continue;
      if (!inferred.has(part.name)) inferred.set(part.name, new Set());
      inferred.get(part.name)!.add(part.basePath);
    }
  }
  const agreed = new Map([...inferred].filter(([, paths]) => paths.size === 1).map(([name, paths]) => [name, [...paths][0]]));
  if (agreed.size) opts = { ...opts, inferredBasePaths: agreed };

  const sorted = [...calls].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  for (const call of sorted) {
    const method = call.method ?? '?';
    const norm = normalizeCallUrl(call.url, opts);
    const found = norm ? matchCall(norm, call.method, backend, own) : null;
    const result = found?.ambiguous ? null : found;
    if (result) {
      matchedCalls++;
      for (const ep of result.endpoints) {
        called.add(ep.id);
        graph.addEdge({ source: call.source, target: ep.id, kind: 'http', certain: result.certain, line: call.line, ...(result.via ? { via: result.via } : {}) });
      }
      continue;
    }
    let target: string;
    let reason: string;
    if (!norm) {
      target = DYNAMIC_ID;
      reason = 'dynamic URL';
      graph.addNode({ id: target, kind: 'unmatched', name: '(dynamic URL)', method: '?', path: '(dynamic)' });
    } else {
      target = `unmatched:${method} ${norm.display}`;
      reason = found?.ambiguous
        ? `ambiguous: ${found.endpoints.length} endpoints match`
        : norm.target === 'backend'
          ? backendRoutes
            ? `no ${backendRoutes} matches`
            : 'calls the backend, which was not analyzed (no --backend)'
          : norm.target === 'relative'
            ? backendRoutes
              ? `no ${ownRoutes} or ${backendRoutes} matches`
              : `no ${ownRoutes} matches (no backend was analyzed)`
            : norm.target === 'external'
              ? 'external URL'
              : 'unknown base URL and no suffix match';
      graph.addNode({ id: target, kind: 'unmatched', name: `${method} ${norm.display}`, method, path: norm.display });
    }
    graph.addEdge({ source: call.source, target, kind: 'http', certain: false, line: call.line, via: 'unmatched' });
    unmatchedCalls.push({ target, source: call.source, file: call.file, line: call.line, method, url: call.raw, reason });
  }
  const unmatchedEndpoints = sides.frontend ? endpoints.filter((e) => !called.has(e.id)).map((e) => e.id).sort() : [];
  return { matchedCalls, unmatchedCalls, unmatchedEndpoints };
}
