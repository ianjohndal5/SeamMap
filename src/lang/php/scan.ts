import type { CodemapConfig } from '../../config.js';
import { scanFiles } from '../../scan.js';
import type { ComposerInfo } from './composer.js';

/** Directories never scanned on the Laravel side. */
export const LARAVEL_SKIP = [
  'vendor/**',
  'storage/**',
  'bootstrap/cache/**',
  'public/**',
  'node_modules/**',
  'database/**',
  'config/**',
  'tests/**',
  'resources/views/**',
  'routes/console.php',
  'routes/channels.php',
];

/** PHP files to analyze: PSR-4 source roots + routes/, relative POSIX paths, sorted. */
export function scanLaravel(root: string, composer: ComposerInfo, config: CodemapConfig, warnings?: string[]): string[] {
  const dirs = new Set<string>(['routes']);
  for (const { dirs: ds } of composer.psr4) for (const d of ds) dirs.add(d);
  const patterns: string[] = [];
  for (const d of dirs) patterns.push(d === '' ? '**/*.php' : `${d}/**/*.php`);
  for (const f of composer.files) patterns.push(f);
  patterns.push(...config.laravel.include);
  return scanFiles(root, patterns, LARAVEL_SKIP, config.laravel.exclude, warnings);
}
