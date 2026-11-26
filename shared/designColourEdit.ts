/**
 * Which colours an already-published design would gain or lose, and which
 * scenes have no approved blank for a colour being added. Nothing here calls
 * Shopify or Printify.
 */

export type SceneBlank = {
  panelId: string;
  label: string;
  colours: ReadonlyArray<{ name: string; kind: string }>;
};

export function diffColourNames(live: readonly string[], wanted: readonly string[]): { add: string[]; remove: string[] } {
  const liveKeys = new Set(live.map(colourKey));
  const wantedKeys = new Set(wanted.map(colourKey));
  const add = wanted.filter((name) => name.trim() && !liveKeys.has(colourKey(name)));
  const remove = live.filter((name) => name.trim() && !wantedKeys.has(colourKey(name)));
  return { add, remove };
}

/** A stored produced photograph. White's approved blank is its white master. */
export function sceneHasApprovedBlank(scene: SceneBlank, colourName: string): boolean {
  const key = colourKey(colourName);
  const rows = scene.colours.filter((colour) => colourKey(colour.name) === key);
  if (!rows.length) return false;
  if (key === "white") return rows.some((row) => row.kind === "white-master" || row.kind === "produced");
  return rows.some((row) => row.kind === "produced");
}

export function scenesMissingApprovedBlank(scenes: readonly SceneBlank[], colourName: string): SceneBlank[] {
  return scenes.filter((scene) => !sceneHasApprovedBlank(scene, colourName));
}

export function colourKey(name: string): string {
  return name.trim().toLowerCase();
}
