const STORAGE_KEY = "appai_creator_cart";

export type CreatorCartSnapshot = {
  cartId: string;
  checkoutUrl: string;
  itemCount: number;
  username: string;
};

function readRaw(): CreatorCartSnapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreatorCartSnapshot;
    if (!parsed?.cartId || !parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readCreatorCart(username?: string | null): CreatorCartSnapshot | null {
  const snap = readRaw();
  if (!snap) return null;
  const handle = String(username || "").trim().toLowerCase();
  if (handle && snap.username.toLowerCase() !== handle) return null;
  return snap;
}

export function writeCreatorCart(snap: CreatorCartSnapshot): void {
  const payload = JSON.stringify({
    cartId: snap.cartId,
    checkoutUrl: snap.checkoutUrl,
    itemCount: snap.itemCount,
    username: String(snap.username || "").toLowerCase(),
  });
  try {
    sessionStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* ignore */
  }
}

export function clearCreatorCart(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function creatorCartPath(username: string): string {
  return `/c/${encodeURIComponent(String(username || "").trim())}/cart`;
}
