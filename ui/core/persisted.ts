// The panel's state that outlives the window, which the host keeps as text.

const RECENT_THEMES_LIMIT = 12;

export type Persisted = {
  favorites: string[];
  recentThemes: string[];
  reference: string | null;
  /** False once the user turns live preview off, or puts its setup off. */
  livePreview: boolean;
};

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Reads the text of the last `writeState`. A field that is missing or malformed
 * reads as its default, so a new field keeps the others.
 */
export function readPersisted(text: string | null): Persisted {
  let read: unknown = null;
  try {
    read = text === null ? null : JSON.parse(text);
  } catch (error) {
    console.error("ghostty-designer: cannot read the saved state:", error);
  }
  const fields: Record<string, unknown> =
    typeof read === "object" && read !== null ? {...read} : {};
  const {favorites, recentThemes, reference, livePreview} = fields;
  return {
    favorites: isStrings(favorites) ? favorites : [],
    recentThemes: isStrings(recentThemes) ? recentThemes : [],
    reference: typeof reference === "string" ? reference : null,
    livePreview: typeof livePreview === "boolean" ? livePreview : true,
  };
}

export function withFavorite(persisted: Persisted, theme: string, on: boolean) {
  const others = persisted.favorites.filter((name) => name !== theme);
  return {...persisted, favorites: on ? [...others, theme] : others};
}

/** `theme` first among the recent themes. */
export const withRecentTheme = (persisted: Persisted, theme: string) => ({
  ...persisted,
  recentThemes: [
    theme,
    ...persisted.recentThemes.filter((name) => name !== theme),
  ].slice(0, RECENT_THEMES_LIMIT),
});
