import fs from 'node:fs';
import path from 'node:path';
import type { Framework } from '../../framework.js';
import { nextPattern } from '../../match/url.js';
import { readJsonFile } from '../../util/jsonc.js';
import { NextAdapter } from './index.js';

function hasNextDependency(dir: string, { peer = true } = {}): boolean {
  const pkg = readJsonFile(path.join(dir, 'package.json')) as Record<string, Record<string, string>> | null;
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next ?? (peer ? pkg.peerDependencies?.next : undefined));
}

const APP_SHAPE = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'app', 'pages', 'src/app', 'src/pages'];

/**
 * A Next.js app, as opposed to a library in the same monorepo that builds on Next (peer dependency, no pages): `next`
 * as a dependency, and a next.config file or an app/ or pages/ folder.
 */
function isNextApp(dir: string): boolean {
  return hasNextDependency(dir, { peer: false }) && APP_SHAPE.some((f) => fs.existsSync(path.join(dir, f)));
}

/** Next.js: JS/TS, App and Pages Router, route handlers as endpoints of its own, the frontend side. */
export const next: Framework = {
  id: 'next',
  name: 'Next.js',
  language: 'JS/TS',
  side: 'frontend',
  marker: 'package.json with a "next" dependency, and app/, pages/ or a next.config file',
  isRoot: isNextApp,
  checkRoot: (dir) => (hasNextDependency(dir) ? [] : [`${dir} has no package.json with a "next" dependency; analyzing it as a Next.js project anyway.`]),
  exclude: (config) => config.next.exclude,
  createAdapter: (root, config, warnings, options) => new NextAdapter(root, config, warnings, options),
  endpointPattern: nextPattern,
};
