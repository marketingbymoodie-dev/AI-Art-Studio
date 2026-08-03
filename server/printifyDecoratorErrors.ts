/** Printify shop create often returns code 6002 when the decorator can't fulfill this blueprint. */
export function isPrintifyDecoratorUnavailableError(message: string): boolean {
  const m = String(message || "").toLowerCase();
  return (
    (m.includes("decorator") && m.includes("not available")) ||
    m.includes("code\":6002") ||
    m.includes("code\": 6002") ||
    m.includes('"code":6002')
  );
}
