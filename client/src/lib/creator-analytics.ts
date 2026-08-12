/**
 * Creator Marketplace Phase 4 — lightweight client beacons.
 */
import type { CreatorEventType } from "@shared/creatorMarketplace";

const SESSION_KEY = "appai_creator_session";

export function getOrCreateCreatorSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return `cs_${Date.now()}`;
  }
}

export function setCreatorSessionId(sessionId: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* ignore */
  }
}

function readUtms(): Record<string, string> {
  try {
    const p = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) {
      const v = p.get(k);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function ensureCreatorAnalyticsSession(opts: {
  creatorId?: string;
  creatorUsername?: string;
}): Promise<string> {
  const sessionId = getOrCreateCreatorSessionId();
  const utms = readUtms();
  try {
    const res = await fetch("/api/creators/analytics/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creatorId: opts.creatorId,
        creatorUsername: opts.creatorUsername,
        sessionId,
        landingPath: `${window.location.pathname}${window.location.search}`.slice(0, 500),
        referrer: document.referrer || null,
        utmSource: utms.utm_source || null,
        utmMedium: utms.utm_medium || null,
        utmCampaign: utms.utm_campaign || null,
        utmContent: utms.utm_content || null,
      }),
      keepalive: true,
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.sessionId) {
        setCreatorSessionId(String(data.sessionId));
        return String(data.sessionId);
      }
    }
  } catch {
    /* non-blocking */
  }
  return sessionId;
}

export function trackCreatorEvent(opts: {
  creatorId?: string;
  creatorUsername?: string;
  eventType: CreatorEventType;
  path?: string;
  customizerPageId?: string;
  productTypeId?: number | string | null;
  generationJobId?: string;
  stylePreset?: string;
  metadata?: Record<string, unknown>;
}): void {
  const sessionId = getOrCreateCreatorSessionId();
  const body = {
    creatorId: opts.creatorId,
    creatorUsername: opts.creatorUsername,
    sessionId,
    eventType: opts.eventType,
    path: opts.path || `${window.location.pathname}${window.location.search}`,
    customizerPageId: opts.customizerPageId,
    productTypeId: opts.productTypeId != null ? Number(opts.productTypeId) : null,
    generationJobId: opts.generationJobId,
    stylePreset: opts.stylePreset,
    metadata: opts.metadata,
  };
  try {
    void fetch("/api/creators/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
