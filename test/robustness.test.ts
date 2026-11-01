import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { defaultConfig, loadConfig } from '../src/config.js';
import { findProjects, resolveRoots } from '../src/detect.js';
import { scanNext } from '../src/lang/js/scan.js';
import type { Graph } from '../src/types.js';

// Inputs real projects contain that once broke a run or gave a wrong map (found by running on open-source apps).

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seammap-robust-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

const canLink = (() => {
  try {
    fs.symlinkSync(tmp, path.join(tmp, '.probe'));
    fs.unlinkSync(path.join(tmp, '.probe'));
    return true;
  } catch {
    return false; // Windows without developer mode
  }
})();
const canLock = process.platform !== 'win32' && process.getuid?.() !== 0;

const run = (backend: string | null, frontend: string | null, config = defaultConfig()): Graph => analyze({ backend, frontend, config }).graph;
const endpointPaths = (g: Graph) => g.nodes.filter((n) => n.kind === 'endpoint').map((n) => `${n.method} ${n.path}`).sort();

describe('filesystem', () => {
  it.runIf(canLink)('does not follow symbolic links: no loops, nothing from outside the project', () => {
    const root = path.join(tmp, 'links');
    write(root, { 'web/package.json': '{}', 'web/lib/a.ts': 'export const a = 1;', 'outside/secret.ts': 'export const s = 1;' });
    fs.symlinkSync('.', path.join(root, 'web/lib/self'));
    fs.symlinkSync('../..', path.join(root, 'web/lib/up'));
    fs.symlinkSync(path.join(root, 'outside/secret.ts'), path.join(root, 'web/lib/leak.ts'));
    const warnings: string[] = [];
    expect(scanNext(path.join(root, 'web'), defaultConfig(), warnings)).toEqual(['lib/a.ts']);
    expect(warnings.join('\n')).toMatch(/Skipped 1 symbolic link.*lib\/leak\.ts/);
  });

  it.runIf(canLock)('skips folders it cannot read instead of stopping, even ones it never scans', () => {
    const root = path.join(tmp, 'locked');
    write(root, { 'package.json': '{}', 'lib/a.ts': '', 'data/db/x.ts': '', 'lib/private/y.ts': '' });
    const locked = [path.join(root, 'data/db'), path.join(root, 'lib/private')];
    for (const d of locked) fs.chmodSync(d, 0o000);
    try {
      expect(scanNext(root, defaultConfig())).toEqual(['lib/a.ts']);
    } finally {
      for (const d of locked) fs.chmodSync(d, 0o755);
    }
  });

  it('applies .gitignore files above the project up to the repository root, unless they ignore the project itself', () => {
    const repo = path.join(tmp, 'repo');
    write(repo, { '.gitignore': 'apps/web/generated/\nsandbox/\n', 'apps/web/package.json': '{}', 'apps/web/app/page.tsx': '', 'apps/web/generated/client.ts': '' });
    fs.mkdirSync(path.join(repo, '.git'));
    expect(scanNext(path.join(repo, 'apps/web'), defaultConfig())).toEqual(['app/page.tsx']);
    // The repository ignores sandbox/, but analyzing sandbox/demo was asked for explicitly.
    write(repo, { 'sandbox/demo/package.json': '{}', 'sandbox/demo/app/page.tsx': '' });
    expect(scanNext(path.join(repo, 'sandbox/demo'), defaultConfig())).toEqual(['app/page.tsx']);
  });

  it('keeps a nested project apart even when its folder name is .gitignore syntax', () => {
    const root = path.join(tmp, 'nested');
    write(root, {
      'package.json': '{"dependencies":{"next":"15"}}',
      'lib/api.ts': 'export const x = 1;',
      '#api/composer.json': '{}',
      '#api/artisan': '',
      '#api/routes/api.php': "<?php\nRoute::get('/users', fn () => 1);",
      '#api/resources/js/app.js': 'export const y = 2;',
    });
    const g = run(path.join(root, '#api'), root);
    expect(g.nodes.filter((n) => n.kind === 'file' && n.side === 'frontend').map((n) => n.file)).toEqual(['lib/api.ts']);
  });

  it('says so when a side has no files to analyze', () => {
    const root = path.join(tmp, 'empty');
    write(root, { 'composer.json': '{}', artisan: '' });
    expect(run(root, null).meta.warnings.join('\n')).toMatch(/backend: no PHP files to analyze in .*; check the path, and laravel\.include/);
  });

  it.runIf(canLink)('catches the same folder given as backend and frontend through a link', () => {
    const real = path.join(tmp, 'same');
    write(real, { 'composer.json': '{}' });
    fs.symlinkSync(real, path.join(tmp, 'same-link'));
    expect(() => resolveRoots({ backend: real, frontend: path.join(tmp, 'same-link') })).toThrow(/resolve to the same directory/);
  });
});

describe('Laravel routes', () => {
  const laravel = (files: Record<string, string>) => {
    const root = path.join(tmp, `lv-${Object.keys(files).length}-${Math.abs([...JSON.stringify(files)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`);
    write(root, { 'composer.json': '{"autoload":{"psr-4":{"App\\\\":"app/","Modules\\\\":"modules/"}}}', artisan: '', ...files });
    return root;
  };

  it("reads modules' route files, loaded by their service providers", () => {
    const root = laravel({
      'routes/web.php': "<?php\nRoute::get('/', fn () => 'home');",
      'modules/Blog/Providers/BlogServiceProvider.php':
        "<?php\nnamespace Modules\\Blog\\Providers;\nclass BlogServiceProvider extends ServiceProvider {\n  public function boot(): void { Route::middleware('web')->prefix('blog')->group(__DIR__.'/../Routes/web.php'); }\n}",
      'modules/Blog/Routes/web.php': "<?php\nRoute::get('/posts', fn () => 1);",
      'modules/Shop/Providers/ShopServiceProvider.php':
        "<?php\nnamespace Modules\\Shop\\Providers;\nclass ShopServiceProvider extends ServiceProvider {\n  public function boot(): void { $this->loadRoutesFrom(__DIR__.'/../routes/api.php'); }\n}",
      'modules/Shop/routes/api.php': "<?php\nRoute::get('/shop/cart', fn () => 1);",
    });
    const g = run(root, null);
    expect(endpointPaths(g)).toEqual(['GET /', 'GET /blog/posts', 'GET /shop/cart']);
    expect(g.meta.warnings.join('\n')).not.toMatch(/not found or not scanned/);
  });

  it('keeps routes under a prefix it cannot read, as {prefix}, and says so', () => {
    const root = laravel({ 'routes/web.php': "<?php\nRoute::prefix(config('portal.path'))->group(function () { Route::get('settings', fn () => 1); });\nRoute::group(['prefix' => env('ADMIN')], function () { Route::get('dashboard', fn () => 1); });" });
    const g = run(root, null);
    expect(endpointPaths(g)).toEqual(['GET /{prefix}/dashboard', 'GET /{prefix}/settings']);
    expect(g.meta.warnings.filter((w) => /non-literal route prefix/.test(w))).toHaveLength(2);
  });

  it('keeps the first of two routes that differ only in parameter names, and the last of two identical ones', () => {
    const root = laravel({
      'app/Http/Controllers/C.php': '<?php\nnamespace App\\Http\\Controllers;\nclass C { public function a() {} public function b() {} public function c() {} public function d() {} }',
      'routes/web.php': [
        '<?php',
        'use App\\Http\\Controllers\\C;',
        "Route::get('/items/{id}', [C::class, 'a']);",
        "Route::get('/items/{slug}', [C::class, 'b']);",
        "Route::get('/same', [C::class, 'c']);",
        "Route::get('/same', [C::class, 'd']);",
      ].join('\n'),
    });
    const g = run(root, null);
    const handler = (p: string) => g.edges.find((e) => e.kind === 'handles' && e.source === g.nodes.find((n) => n.kind === 'endpoint' && n.path === p)?.id)?.target;
    expect(handler('/items/{id}')).toBe('be:App\\Http\\Controllers\\C::a');
    expect(handler('/same')).toBe('be:App\\Http\\Controllers\\C::d');
    expect(g.meta.warnings.join('\n')).toMatch(/\/items\/\{slug\}.*same pattern as \/items\/\{id\}/);
  });

  it('does not report a non-route file required by bootstrap/app.php as a missing route file', () => {
    const root = laravel({
      'routes/web.php': "<?php\nRoute::get('/', fn () => 1);",
      'bootstrap/app.php': "<?php\nreturn Application::configure(basePath: dirname(__DIR__))\n  ->withRouting(web: __DIR__.'/../routes/web.php')\n  ->withSchedule(function ($s) { require __DIR__.'/tasks.php'; })\n  ->create();",
    });
    expect(run(root, null).meta.warnings.join('\n')).not.toMatch(/not found or not scanned/);
  });
});

describe('Next.js', () => {
  it('counts tsconfig aliases into folders outside the project as external, like relative imports', () => {
    const root = path.join(tmp, 'mono/apps/web');
    write(path.join(tmp, 'mono'), { 'packages/ui/button.ts': 'export const Button = 1;' });
    write(root, {
      'package.json': '{"dependencies":{"next":"15"}}',
      'tsconfig.json': '{"compilerOptions":{"paths":{"@ui/*":["../../packages/ui/*"]}}}',
      'app/page.tsx': "import { Button } from '@ui/button';\nexport default function Page() { return Button; }",
    });
    expect(run(null, root).meta.stats.unresolvedImports).toBe(0);
  });

  it('tells Next.js apps from libraries that build on Next in a monorepo', () => {
    const root = path.join(tmp, 'turbo');
    write(root, {
      'apps/web/package.json': '{"dependencies":{"next":"15"}}',
      'apps/web/app/page.tsx': '',
      'packages/ui/package.json': '{"peerDependencies":{"next":"15"}}',
      'packages/utils/package.json': '{"devDependencies":{"next":"15"}}',
    });
    expect(findProjects(root).next).toEqual([path.join(root, 'apps/web')]);
  });

  it('marks proxy.ts (Next.js 16) like middleware.ts', () => {
    const root = path.join(tmp, 'proxy');
    write(root, { 'package.json': '{"dependencies":{"next":"16"}}', 'proxy.ts': 'export function proxy() {}' });
    expect(run(null, root).nodes.find((n) => n.id === 'fe:proxy.ts')?.nextKind).toBe('proxy');
  });
});

describe('config file', () => {
  const cfg = (name: string, text: string) => {
    write(tmp, { [`cfg/${name}`]: text });
    return () => loadConfig(path.join(tmp, 'cfg', name), tmp);
  };

  it('rejects a config that is not an object, and sections that are not objects, naming the file', () => {
    expect(cfg('null.json', 'null')).toThrow(/null\.json: the config must be a JSON object/);
    expect(cfg('section.json', '{ "laravel": "app/**" }')).toThrow(/section\.json: "laravel" must be an object/);
  });

  it('warns about unknown keys, with a suggestion', () => {
    const { warnings } = cfg('typo.json', '{ "laravell": {}, "next": { "exlude": [] } }')();
    expect(warnings).toEqual([
      'typo.json: unknown key "laravell" is ignored (did you mean "laravel"?)',
      'typo.json: unknown key "next.exlude" is ignored (did you mean "next.exclude"?)',
    ]);
  });

  it('keeps include patterns inside the project', () => {
    expect(cfg('outside.json', '{ "next": { "include": ["../shared/**/*.ts"] } }')).toThrow(/"next\.include" patterns .* must stay inside it \(got "\.\.\/shared/);
  });
});
