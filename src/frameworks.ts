import type { Framework } from './framework.js';
import { next } from './lang/js/framework.js';
import { laravel } from './lang/php/framework.js';
import type { Side } from './types.js';

/**
 * Every supported framework. Order matters: for a project root, the first framework of its side that recognizes it
 * is used, and the first of each side is the default when none does.
 */
export const FRAMEWORKS: readonly Framework[] = [laravel, next];

export function frameworkById(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}

export function frameworksOn(side: Side): Framework[] {
  return FRAMEWORKS.filter((f) => f.side === side);
}

/** The framework of a project root: the first of its side that recognizes it, else the side's default. */
export function frameworkFor(side: Side, root: string): Framework {
  const candidates = frameworksOn(side);
  return candidates.find((f) => f.isRoot(root)) ?? candidates[0]!;
}

/** "Laravel or Symfony"-style list of a side's frameworks with their markers, for messages. */
export function describeSide(side: Side): string {
  return frameworksOn(side)
    .map((f) => `${f.name} project (${f.marker})`)
    .join(' or ');
}
