import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../../util/jsonc.js';
import { normalizeRel, toPosix } from '../../util/paths.js';

// composer.json: the PSR-4 map that says which folders hold PHP classes, and the autoloaded files.

export interface ComposerInfo {
  /** PSR-4 prefixes ("App\\") with directories relative to the backend root, longest prefix first. */
  psr4: { prefix: string; dirs: string[] }[];
  /** composer "files" autoload entries (relative). */
  files: string[];
}

export function readComposer(root: string, warnings: string[]): ComposerInfo {
  const file = path.join(root, 'composer.json');
  const json = fs.existsSync(file) ? (readJsonFile(file) as Record<string, any> | null) : null;
  if (!json) {
    if (fs.existsSync(file)) {
      let readable = true;
      try {
        fs.accessSync(file, fs.constants.R_OK);
      } catch {
        readable = false;
      }
      warnings.push(`Could not ${readable ? 'parse' : 'read'} ${file}; using default PSR-4 mapping App\\ => app/.`);
    }
    return { psr4: [{ prefix: 'App\\', dirs: ['app'] }], files: [] };
  }
  const psr4: ComposerInfo['psr4'] = [];
  const raw = (json.autoload?.['psr-4'] ?? {}) as Record<string, string | string[]>;
  for (const [prefix, dirs] of Object.entries(raw)) {
    const list = (Array.isArray(dirs) ? dirs : [dirs])
      .map((d) => normalizeRel(toPosix(d)))
      .filter((d): d is string => d !== null);
    psr4.push({ prefix, dirs: list.length ? list : [''] });
  }
  if (psr4.length === 0) {
    warnings.push('composer.json has no autoload.psr-4 section; using App\\ => app/.');
    psr4.push({ prefix: 'App\\', dirs: ['app'] });
  }
  psr4.sort((a, b) => b.prefix.length - a.prefix.length || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  const files = ((json.autoload?.files ?? []) as string[])
    .map((f) => normalizeRel(toPosix(f)))
    .filter((f): f is string => f !== null);
  return { psr4, files };
}
