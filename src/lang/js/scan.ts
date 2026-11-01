import type { CodemapConfig } from '../../config.js';
import { scanFiles } from '../../scan.js';

/** Paths never scanned on the Next.js side. */
export const NEXT_SKIP = [
  '**/node_modules/**',
  '**/.next/**',
  'out/**',
  '**/build/**',
  '**/dist/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.mjs',
  '**/*.d.ts',
];

/** JS/TS files of the Next.js project, relative POSIX paths, sorted. */
export function scanNext(root: string, config: CodemapConfig, warnings?: string[]): string[] {
  return scanFiles(root, ['**/*.{js,jsx,ts,tsx,mjs,cjs}', ...config.next.include], NEXT_SKIP, config.next.exclude, warnings);
}
