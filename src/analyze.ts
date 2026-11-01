import path from 'node:path';
import type { Adapter } from './adapter.js';
import { GraphBuilder } from './graph.js';
import { frameworkFor } from './frameworks.js';
import { link } from './link.js';
import { SCHEMA_VERSION } from './schema.js';
import { analyzeSecurity } from './security/index.js';
import type { AnalyzeOptions, Graph, Side, Stats, Timings } from './types.js';
import { toPosix } from './util/paths.js';
import { VERSION } from './brand.js';

export { VERSION };
export type { AnalyzeOptions };

export interface AnalyzeResult {
  graph: Graph;
  adapters: Adapter[];
}

type Stage = Exclude<keyof Timings, 'security'>;

function timed(timings: Timings, stage: Stage, fn: () => void): void {
  const t0 = performance.now();
  fn();
  timings[stage] += performance.now() - t0;
}

/** meta.config: the config file relative to the first analyzed root, so that it reads the same on every machine. */
function configRecord(config: AnalyzeOptions['config'], root: string | null): Graph['meta']['config'] {
  if (!config.source) return null;
  const rel = root ? path.relative(root, config.source.file) : config.source.file;
  return { path: toPosix(rel), sha256: config.source.sha256 };
}

/** Run the whole pipeline (scan -> parse -> extract -> resolve -> link) without any UI. */
export function analyze(opts: AnalyzeOptions): AnalyzeResult {
  const started = performance.now();
  const warnings = opts.warnings ?? [];
  const config = opts.config;
  const timings: Timings = { scan: 0, parse: 0, extract: 0, resolve: 0, link: 0 };
  const graph = new GraphBuilder({ ranges: Boolean(opts.security) });

  const projects = (['backend', 'frontend'] as const)
    .filter((side) => opts[side])
    .map((side) => ({ root: opts[side]!, framework: frameworkFor(side, opts[side]!) }));

  // When one project lives inside the other (monorepo), keep their files apart.
  for (const outer of projects) {
    for (const inner of projects) {
      const rel = path.relative(outer.root, inner.root);
      // Escaped: exclude patterns are .gitignore syntax, where #, !, [ ... in a folder name mean something.
      if (inner !== outer && rel && !rel.startsWith('..') && !path.isAbsolute(rel)) outer.framework.exclude(config).push(`${toPosix(rel).replace(/[\\[\]*?!#]/g, '\\$&')}/**`);
    }
  }

  const frameworkRecord = (side: Side) => {
    const f = projects.find((p) => p.framework.side === side)?.framework;
    return f ? { id: f.id, name: f.name, language: f.language } : null;
  };

  const keepSyntax = Boolean(opts.security);
  const adapters: Adapter[] = projects.map(({ root, framework }) => framework.createAdapter(root, config, warnings, { keepSyntax }));

  for (const stage of ['scan', 'parse', 'extract', 'resolve'] as const) {
    opts.onStage?.(stage);
    for (const a of adapters) timed(timings, stage, () => (stage === 'resolve' ? a.resolve(graph) : a[stage]()));
  }

  for (const [i, a] of adapters.entries()) {
    const { framework, root } = projects[i]!;
    if (!a.stats.files) warnings.push(`${a.side}: no ${framework.language} files to analyze in ${root}; check the path, and ${framework.id}.include / ${framework.id}.exclude if a config file sets them.`);
  }

  const endpoints = adapters.flatMap((a) => a.endpoints);
  const httpCalls = adapters.flatMap((a) => a.httpCalls);
  let linked = { matchedCalls: 0, unmatchedCalls: [] as Graph['unmatched']['httpCalls'], unmatchedEndpoints: [] as string[] };
  opts.onStage?.('link');
  timed(timings, 'link', () => {
    linked = link(graph, httpCalls, endpoints, {
      backendEnvVars: config.next.backendEnvVars,
      backendHosts: config.next.backendHosts,
      ...(config.next.backendBasePath !== undefined ? { backendBasePath: config.next.backendBasePath } : {}),
    }, { backend: projects.find((p) => p.framework.side === 'backend')?.framework ?? null, frontend: projects.find((p) => p.framework.side === 'frontend')?.framework ?? null });
  });

  const { nodes, edges } = graph.sorted();
  const unresolvedByReason: Record<string, number> = {};
  for (const a of adapters) {
    for (const [k, v] of Object.entries(a.stats.unresolvedByReason)) {
      const key = `${a.side}:${k}`;
      unresolvedByReason[key] = (unresolvedByReason[key] ?? 0) + v;
    }
  }
  const sum = (f: (a: Adapter) => number) => adapters.reduce((n, a) => n + f(a), 0);
  const stats: Stats = {
    files: sum((a) => a.stats.files),
    definitions: sum((a) => a.stats.definitions),
    edges: edges.length,
    endpoints: endpoints.length,
    unresolvedCalls: sum((a) => a.stats.unresolvedCalls),
    unmatchedHttpCalls: linked.unmatchedCalls.length,
    unmatchedEndpoints: linked.unmatchedEndpoints.length,
    parseErrors: sum((a) => a.stats.parseErrors),
    httpCalls: httpCalls.length,
    uncertainEdges: edges.filter((e) => !e.certain).length,
    unresolvedImports: sum((a) => a.stats.unresolvedImports),
    unresolvedHandlers: sum((a) => a.stats.unresolvedHandlers),
    unresolvedByReason: Object.fromEntries(Object.entries(unresolvedByReason).sort()),
  };
  for (const k of Object.keys(timings) as Stage[]) timings[k] = Math.round(timings[k]);
  if (graph.diagnosticsDropped) warnings.push(`${graph.diagnosticsDropped} more diagnostics were not recorded (at most 250 per reason).`);

  const result: Graph = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      tool: 'seammap',
      version: VERSION,
      backendRoot: opts.backend ? toPosix(opts.backend) : null,
      frontendRoot: opts.frontend ? toPosix(opts.frontend) : null,
      frameworks: { backend: frameworkRecord('backend'), frontend: frameworkRecord('frontend') },
      config: configRecord(config, opts.backend ?? opts.frontend),
      generatedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      timings,
      stats,
      warnings,
    },
    nodes,
    edges,
    unmatched: { endpoints: linked.unmatchedEndpoints, httpCalls: linked.unmatchedCalls },
    diagnostics: graph.diagnostics,
  };
  if (opts.security) {
    opts.onStage?.('security');
    const t0 = performance.now();
    result.security = analyzeSecurity(result, adapters, config.security);
    timings.security = Math.round(performance.now() - t0);
    result.meta.durationMs = Math.round(performance.now() - started);
  }
  return { graph: result, adapters };
}
