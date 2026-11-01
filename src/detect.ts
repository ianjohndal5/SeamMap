import fs from 'node:fs';
import path from 'node:path';
import { describeSide, FRAMEWORKS, frameworkFor, frameworksOn } from './frameworks.js';
import type { Side } from './types.js';

const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.next', 'storage', 'dist', 'build', 'out', 'coverage']);

/**
 * Find project roots below `root` (including root itself), breadth-first up to `maxDepth`, keyed by framework id
 * (every registered framework has a key, possibly with an empty list).
 */
export function findProjects(root: string, maxDepth = 3): { laravel: string[]; next: string[] } & Record<string, string[]> {
  const found = Object.fromEntries(FRAMEWORKS.map((f) => [f.id, [] as string[]])) as { laravel: string[]; next: string[] } & Record<string, string[]>;
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const nextLevel: string[] = [];
    for (const dir of level) {
      for (const f of FRAMEWORKS) if (f.isRoot(dir)) found[f.id]!.push(dir);
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) nextLevel.push(path.join(dir, e.name));
      }
    }
    nextLevel.sort();
    level = nextLevel;
  }
  return found;
}

export interface Roots {
  backend: string | null;
  frontend: string | null;
  warnings: string[];
}

/** Resolve the projects to analyze from CLI/config input. Throws with a user-facing message. */
/**
 * Resolve the projects to analyze. `origin` says where a given root came from, for error messages ("backend in
 * seammap.config.json"); the default is the command-line flag.
 */
export function resolveRoots(opts: { backend?: string; frontend?: string; root?: string; origin?: { backend?: string; frontend?: string } }): Roots {
  const warnings: string[] = [];
  const checkDir = (p: string, flag: string) => {
    const from = flag === '--backend' ? opts.origin?.backend : flag === '--frontend' ? opts.origin?.frontend : undefined;
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return;
    throw new Error(from ? `${from} points to ${p}, which does not exist or is not a directory` : `${flag} path does not exist or is not a directory: ${p}`);
  };
  let backend = opts.backend ?? null;
  let frontend = opts.frontend ?? null;

  if (opts.root && (!backend || !frontend)) {
    checkDir(opts.root, '<root>');
    const found = findProjects(opts.root);
    // One project per side: several (of any of the side's frameworks) is ambiguous.
    const pick = (side: Side, flag: string): string | null => {
      const fws = frameworksOn(side).filter((f) => found[f.id]!.length);
      const dirs = [...new Set(fws.flatMap((f) => found[f.id]!))];
      if (dirs.length > 1) {
        throw new Error(`Found several ${fws.map((f) => f.name).join(' / ')} projects under ${opts.root}:\n  ${dirs.join('\n  ')}\nPass the one to analyze with ${flag} <path>.`);
      }
      return dirs[0] ?? null;
    };
    if (!backend) backend = pick('backend', '--backend');
    if (!frontend) frontend = pick('frontend', '--frontend');
    if (!backend && !frontend) {
      throw new Error(
        `No ${describeSide('backend')} or ${describeSide('frontend')} found under ${opts.root}.\n` +
          'Pass the projects explicitly: seammap --backend <laravelPath> --frontend <nextPath>',
      );
    }
  }
  if (!backend && !frontend) {
    throw new Error('Nothing to analyze. Usage: seammap --backend <laravelPath> --frontend <nextPath>  or  seammap <monorepoRoot>');
  }
  const names = (side: Side) => frameworksOn(side).map((f) => f.name).join(' or ');
  if (backend) {
    backend = path.resolve(backend);
    checkDir(backend, '--backend');
    warnings.push(...frameworkFor('backend', backend).checkRoot(backend));
  } else warnings.push(`No ${names('backend')} backend given or detected; analyzing the frontend only.`);
  if (frontend) {
    frontend = path.resolve(frontend);
    checkDir(frontend, '--frontend');
    warnings.push(...frameworkFor('frontend', frontend).checkRoot(frontend));
  } else warnings.push(`No ${names('frontend')} frontend given or detected; analyzing the backend only.`);
  if (backend && frontend && (backend === frontend || fs.realpathSync(backend) === fs.realpathSync(frontend))) {
    throw new Error(`Backend and frontend resolve to the same directory (${backend}). Pass them explicitly with --backend and --frontend.`);
  }
  return { backend, frontend, warnings };
}
