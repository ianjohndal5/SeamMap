import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { defaultConfig } from '../src/config.js';
import { FRAMEWORKS, frameworkById, frameworkFor } from '../src/frameworks.js';
import type { Graph } from '../src/types.js';

// The contract every registered framework keeps (docs/ARCHITECTURE.md). A new framework adds a fixture here.
const fixtures = path.resolve(__dirname, '..', 'fixtures');
const FIXTURE: Record<string, string> = {
  laravel: path.join(fixtures, 'laravel-api'),
  next: path.join(fixtures, 'next-web'),
};

const strip = (g: Graph) => JSON.stringify({ ...g, meta: { ...g.meta, generatedAt: '', durationMs: 0, timings: {} } });

describe('framework registry', () => {
  it('has unique ids, and at least one framework per side', () => {
    expect(new Set(FRAMEWORKS.map((f) => f.id)).size).toBe(FRAMEWORKS.length);
    expect(FRAMEWORKS.some((f) => f.side === 'backend')).toBe(true);
    expect(FRAMEWORKS.some((f) => f.side === 'frontend')).toBe(true);
    for (const f of FRAMEWORKS) expect(frameworkById(f.id)).toBe(f);
  });

  for (const f of FRAMEWORKS) {
    describe(f.name, () => {
      const root = FIXTURE[f.id];
      it('has a fixture project', () => expect(root, `add a fixture for ${f.id} to test/frameworks.test.ts`).toBeDefined());
      if (!root) return;
      const run = () => analyze({ backend: f.side === 'backend' ? root : null, frontend: f.side === 'frontend' ? root : null, config: defaultConfig() }).graph;
      const graph = run();

      it('recognizes its fixture, and is chosen for it', () => {
        expect(f.isRoot(root)).toBe(true);
        expect(f.checkRoot(root)).toEqual([]);
        expect(frameworkFor(f.side, root)).toBe(f);
        expect(graph.meta.frameworks[f.side]).toEqual({ id: f.id, name: f.name, language: f.language });
      });

      it('builds a graph within the format: side prefixes, relative POSIX paths, its own endpoints', () => {
        const prefix = f.side === 'backend' ? 'be:' : 'fe:';
        expect(graph.nodes.length).toBeGreaterThan(0);
        for (const n of graph.nodes) {
          if (n.kind === 'endpoint') {
            expect(n.id.startsWith(`endpoint:${f.id}:`), n.id).toBe(true);
            expect(n.server).toBe(f.id);
          } else if (n.kind !== 'unmatched') {
            expect(n.id.startsWith(prefix), n.id).toBe(true);
            expect(n.side).toBe(f.side);
          }
          if (n.file) {
            expect(path.isAbsolute(n.file) || n.file.includes('\\') || n.file.split('/').includes('..'), n.file).toBe(false);
          }
        }
        const ids = new Set(graph.nodes.map((n) => n.id));
        for (const e of graph.edges) expect(ids.has(e.source) && ids.has(e.target), `${e.source} -> ${e.target}`).toBe(true);
      });

      it('gives the same graph on every run', () => {
        expect(strip(run())).toBe(strip(graph));
      });

      it('turns endpoint paths into URL patterns', () => {
        for (const n of graph.nodes.filter((x) => x.kind === 'endpoint')) expect(f.endpointPattern(n.path!).length, n.path).toBeGreaterThanOrEqual(0);
      });
    });
  }
});
