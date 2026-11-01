import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../../util/jsonc.js';
import { relPosix, toPosix } from '../../util/paths.js';

// tsconfig.json / jsconfig.json: baseUrl and path aliases (@/...), for module resolution.

export interface TsPaths {
  /** Directory (relative to the frontend root, '' = root) that `paths` targets are relative to. */
  baseDir: string;
  /** Whether bare specifiers may resolve against baseDir (only when baseUrl is set). */
  hasBaseUrl: boolean;
  paths: { pattern: string; targets: string[] }[];
}

/** Read compilerOptions.baseUrl/paths, following relative "extends" chains. */
export function readTsPaths(root: string, warnings: string[]): TsPaths {
  const candidates = ['tsconfig.json', 'jsconfig.json'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
  if (candidates.length === 0) {
    warnings.push(`No tsconfig.json or jsconfig.json in ${root}; path aliases such as @/ will not resolve.`);
    return { baseDir: '', hasBaseUrl: false, paths: [] };
  }
  let baseUrl: string | undefined;
  let pathsDir: string | undefined;
  let paths: Record<string, string[]> | undefined;
  const seen = new Set<string>();
  // Walk the extends chain; the most-derived config wins for each option.
  let current: string | undefined = candidates[0];
  while (current && !seen.has(current)) {
    seen.add(current);
    const json = readJsonFile(current) as Record<string, any> | null;
    if (!json) {
      warnings.push(`Could not parse ${current}; ignoring it.`);
      break;
    }
    const co = json.compilerOptions ?? {};
    const dir = path.dirname(current);
    if (baseUrl === undefined && typeof co.baseUrl === 'string') baseUrl = path.resolve(dir, co.baseUrl);
    if (paths === undefined && co.paths && typeof co.paths === 'object') {
      paths = co.paths;
      pathsDir = dir;
    }
    const ext = typeof json.extends === 'string' && json.extends.startsWith('.') ? path.resolve(dir, json.extends) : undefined;
    current = ext && !ext.endsWith('.json') && !fs.existsSync(ext) ? ext + '.json' : ext;
  }
  // Without baseUrl, TypeScript resolves `paths` relative to the config file that declares them.
  const base = baseUrl ?? pathsDir ?? root;
  const baseDir = relPosix(root, base);
  return {
    baseDir: baseDir === '' ? '' : baseDir,
    hasBaseUrl: baseUrl !== undefined,
    paths: Object.entries(paths ?? {}).map(([pattern, targets]) => ({
      pattern,
      targets: (Array.isArray(targets) ? targets : []).map((t) => toPosix(t)),
    })),
  };
}
