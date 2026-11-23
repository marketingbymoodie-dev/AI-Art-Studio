/**
 * A catalogue candidate stores one panel id, and the same candidate can be
 * published as two product types (Softstyle and Comfort Colors). Compositing
 * must use a scene that actually belongs to the product being rendered.
 */
export type MyPetPanelRow = {
  panelId: string;
  isDefault?: boolean | null;
  kind?: string | null;
};

export function chooseMyPetPanelId(
  candidatePanelId: string | null | undefined,
  panels: MyPetPanelRow[],
): string | null {
  const rows = panels.filter((row) => row.panelId);
  const wanted = String(candidatePanelId || "").trim();
  if (wanted && rows.some((row) => row.panelId === wanted)) return wanted;
  const defaults = rows.filter((row) => row.isDefault).map((row) => row.panelId).sort();
  if (defaults.length) return defaults[0];
  const masters = rows.filter((row) => row.kind === "white-master").map((row) => row.panelId).sort();
  if (masters.length) return masters[0];
  const any = rows.map((row) => row.panelId).sort();
  return any[0] || null;
}
