const TOKEN_KEY = "appai_creator_token";

export type CreatorPortalProfile = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  status: string;
  niche: string | null;
  profileImageUrl: string | null;
  bio: string | null;
  branding: Record<string, unknown> | null;
  freeGensPerCustomer: number;
  monthlyGenerationAllowance: number;
  monthlyGenerationsUsed: number;
  generationMonth: string | null;
  shareBasis: string;
  revenueShareCreatorPct: number;
  betaStartAt: string | null;
  betaEndAt: string | null;
};

export function getCreatorPortalToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setCreatorPortalToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearCreatorPortalToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function creatorPortalFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  const token = getCreatorPortalToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers, credentials: "same-origin" });
}

export function formatCents(cents: number | null | undefined): string {
  const n = Number(cents) || 0;
  return (n / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
