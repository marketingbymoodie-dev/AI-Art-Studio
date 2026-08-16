/**
 * Merge persisted enabled flags without resurrecting stale sleeve/trim defaults
 * from older saved designs or admin template `enabled: true`.
 * Zip hoodie sleeves are one customer control — either sleeve (or `sleeves`)
 * saved on must restore both.
 */
export function mergeSavedCustomerEnabled(
  base: Record<string, boolean>,
  saved: Record<string, boolean> | undefined,
): Record<string, boolean> {
  const merged = { ...base, ...(saved ?? {}) };
  const sleevesOn = !!(
    saved &&
    (saved["left-sleeve"] === true ||
      saved["right-sleeve"] === true ||
      saved.sleeves === true)
  );
  merged["left-sleeve"] = sleevesOn;
  merged["right-sleeve"] = sleevesOn;
  if (!saved || saved.trim === undefined) merged.trim = false;
  return merged;
}
