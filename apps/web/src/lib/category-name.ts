/**
 * The message key of a global category: its stable `systemKey` (`leisure-travel`) in camelCase, as
 * every message key is (`categories.leisureTravel` in `pt-PT.json`). Renaming the message renames
 * the category for every pool; logic never reads the name.
 */
export const categoryMessageKey = (systemKey: string): string =>
  systemKey.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
