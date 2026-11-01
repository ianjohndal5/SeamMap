import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import { dirnamePosix, toPosix } from './util/paths.js';

const FAST_GLOB_SKIP = ['**/node_modules/**', '**/vendor/**', '**/.git/**', '**/.next/**'];

/**
 * How every walk reads the filesystem. Symbolic links are not followed: a link can point outside the project (and
 * so read files that aren't part of it) or loop back into it (and never end). Directories that can't be read
 * (permissions, over-long paths) are skipped instead of stopping the run.
 */
const WALK = { followSymbolicLinks: false, suppressErrors: true } as const;

/** The folder of the git repository that contains `root` (the nearest one with a .git), or null. */
function repositoryRoot(root: string): string | null {
  for (let dir = root; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/**
 * Every .gitignore that applies to the project, as git applies them: the project's own (nested ones included) and
 * those of the folders above it, up to the repository root. Answers "is this relative path ignored?".
 */
class GitIgnore {
  /** `prefix`: the project root relative to the .gitignore's folder ('' for the root's own, '../' never). */
  private rules: { dir: string; prefix: string; ig: Ignore }[] = [];

  constructor(root: string, warnings?: string[]) {
    const add = (file: string, dir: string, prefix: string, above = false) => {
      try {
        const ig = ignore().add(fs.readFileSync(file, 'utf8'));
        // A folder above the project that ignores the project itself (or a folder on the way to it): the project was
        // chosen explicitly, so that file's rules don't apply to it.
        if (above && prefix.split('/').slice(0, -1).some((_, i, parts) => ig.ignores(parts.slice(0, i + 1).join('/') + '/'))) return;
        this.rules.push({ dir, prefix, ig });
      } catch (e) {
        warnings?.push(`Could not read ${file} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}); the files it ignores are analyzed.`);
      }
    };
    const repo = repositoryRoot(root);
    if (repo && repo !== root) {
      const above: string[] = [];
      for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
        above.unshift(dir);
        if (dir === repo || path.dirname(dir) === dir) break;
      }
      for (const dir of above) {
        const file = path.join(dir, '.gitignore');
        if (fs.existsSync(file)) add(file, '', toPosix(path.relative(dir, root)) + '/', true);
      }
    }
    const files = fg.sync('**/.gitignore', { cwd: root, dot: true, ignore: FAST_GLOB_SKIP, ...WALK });
    files.sort();
    for (const f of files) add(path.join(root, f), dirnamePosix(f), '');
  }

  ignores(rel: string): boolean {
    for (const { dir, prefix, ig } of this.rules) {
      if (dir === '') {
        if (ig.ignores(prefix + rel)) return true;
      } else if (rel.startsWith(dir + '/')) {
        if (ig.ignores(rel.slice(dir.length + 1))) return true;
      }
    }
    return false;
  }
}

/**
 * The files to analyze under `root`: those matching `patterns`, minus `skip` (the framework's fixed list),
 * `exclude` (from the config) and .gitignored paths. Relative POSIX paths, sorted. Symbolic links among the
 * matches are left out, and counted in a warning.
 */
export function scanFiles(root: string, patterns: string[], skip: string[], exclude: string[], warnings?: string[]): string[] {
  const entries = fg.sync(patterns, { cwd: root, dot: false, onlyFiles: false, objectMode: true, ignore: FAST_GLOB_SKIP, ...WALK });
  const gi = new GitIgnore(root, warnings);
  const skipper = ignore().add(skip).add(exclude);
  const out = new Set<string>();
  const links: string[] = [];
  for (const e of entries) {
    if (skipper.ignores(e.path) || gi.ignores(e.path)) continue;
    if (e.dirent.isSymbolicLink()) links.push(e.path);
    else if (e.dirent.isFile()) out.add(e.path);
  }
  if (links.length) {
    links.sort();
    warnings?.push(`Skipped ${links.length} symbolic link(s) to source files (links are not followed): ${links.slice(0, 5).join(', ')}${links.length > 5 ? ', ...' : ''}`);
  }
  return [...out].sort();
}
