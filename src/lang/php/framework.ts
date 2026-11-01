import fs from 'node:fs';
import path from 'node:path';
import type { Framework } from '../../framework.js';
import { laravelPattern } from '../../match/url.js';
import { LaravelAdapter } from './index.js';

/** Laravel: PHP, routes in routes/*.php, the backend side. */
export const laravel: Framework = {
  id: 'laravel',
  name: 'Laravel',
  language: 'PHP',
  side: 'backend',
  marker: 'composer.json + artisan',
  isRoot: (dir) => fs.existsSync(path.join(dir, 'composer.json')) && fs.existsSync(path.join(dir, 'artisan')),
  checkRoot(dir) {
    if (!fs.existsSync(path.join(dir, 'composer.json'))) return [`${dir} has no composer.json; scanning app/ and routes/ with default PSR-4 (App\\ => app/).`];
    if (!fs.existsSync(path.join(dir, 'artisan'))) return [`${dir} has no artisan file; it may not be a Laravel project.`];
    return [];
  },
  exclude: (config) => config.laravel.exclude,
  createAdapter: (root, config, warnings, options) => new LaravelAdapter(root, config, warnings, options),
  endpointPattern: laravelPattern,
};
