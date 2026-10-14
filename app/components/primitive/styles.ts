/*===== Style Groups =====*/

/** The shared vocabulary for naming Tailwind groups; see docs/components.md. */
type StyleGroup =
  | "layout"
  | "geometry"
  | "typography"
  | "appearance"
  | "interaction"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "invalid"
  | "state"
  | "motion"
  | "icon";

/** A group name, optionally with a descriptive suffix such as `stateAutofill`. */
type StyleGroupKey = StyleGroup | `${StyleGroup}${Capitalize<string>}`;

export type StyleGroups = Partial<Record<StyleGroupKey, string>>;

/** Maps every key outside the group vocabulary to `never`, so typos fail at the call site. */
type OnlyGroups<T> = T & Record<Exclude<keyof T, StyleGroupKey>, never>;

/*===== Style Definitions =====*/

/**
 * Keeps named Tailwind groups readable and their keys inferred.
 * Accepts either one set of groups or a map of variant options to groups; unknown group names
 * fail type-checking. Prettier sorts class strings inside this call; it performs no runtime merging.
 */
export function defineStyles<const T extends StyleGroups>(styles: OnlyGroups<T>): T;
export function defineStyles<const T extends Record<string, StyleGroups>>(styles: {
  [Key in keyof T]: OnlyGroups<T[Key]>;
}): T;
export function defineStyles<T>(styles: T): T {
  return styles;
}

/*===== Class Composition =====*/

/** Joins one set of groups into a class string. */
export function joinStyles(groups: StyleGroups): string {
  return Object.values(groups).join(" ");
}

/**
 * Joins each variant's named groups while retaining literal keys for CVA props.
 * Resolve conflicts with cn only after base, variant, and consumer classes are combined.
 */
export function composeStyles<T extends Record<string, StyleGroups>>(styles: T) {
  return Object.fromEntries(Object.entries(styles).map(([key, groups]) => [key, joinStyles(groups)])) as {
    [Key in keyof T]: string;
  };
}
