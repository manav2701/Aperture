import { z } from 'zod';

/**
 * Model patterns are an exact model id (`openai/gpt-4o-mini`) or a prefix ending in a single
 * trailing `*` (`anthropic/claude-*`, or `*` for any model). Nothing richer: with only prefixes,
 * "is pattern A inside pattern B" is decidable, which mandate attenuation depends on.
 */
export const modelPatternSchema = z
  .string()
  .regex(/^(\*|[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}\*?)$/, 'model pattern must be an id or a prefix ending in *');

export type ModelPattern = z.infer<typeof modelPatternSchema>;

const isPrefix = (pattern: string) => pattern.endsWith('*');
const stem = (pattern: string) => (isPrefix(pattern) ? pattern.slice(0, -1) : pattern);

export function matchesModel(pattern: ModelPattern, model: string): boolean {
  return isPrefix(pattern) ? model.startsWith(stem(pattern)) : model === pattern;
}

/** True when every model matched by `inner` is also matched by `outer`. */
export function patternWithin(inner: ModelPattern, outer: ModelPattern): boolean {
  if (!isPrefix(outer)) return !isPrefix(inner) && inner === outer;
  return stem(inner).startsWith(stem(outer));
}
