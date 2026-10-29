/*===== Allowed Values =====*/

/**
 * Narrows a stored plain-text value to its allowed set.
 *
 * @throws When the value isn't allowed. Only code writes these columns, so this means corrupted data that should
 * surface instead of rendering a guess.
 */
export function oneOf<const T extends readonly string[]>({
  allowed,
  value,
  what,
}: {
  allowed: T;
  value: string;
  what: string;
}): T[number] {
  if (!allowed.includes(value)) throw new Error(`Unknown ${what}: ${value}`);
  return value as T[number];
}
