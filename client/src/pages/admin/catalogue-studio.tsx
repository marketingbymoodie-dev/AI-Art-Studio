import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatCatalogueSpend, publishColourNames } from "@shared/cataloguePublish";
import {
  catalogueDesignCanBeEdited,
  catalogueQueueCounts,
  catalogueQueuePage,
  filterCatalogueQueue,
  readCatalogueQueueTab,
  type CatalogueQueueTab,
} from "@shared/catalogueQueue";
import { publishColourScene, resolvePublishPanelId } from "@shared/colourBlanks";
import type { CatalogueConceptGeneration } from "@shared/catalogueConcept";
import { initialTickedColours, sortCatalogueColours } from "@shared/flywheelPromote";
import { PETPOSTEROUS_PROMPT_PROFILE } from "@shared/packs/petposterous";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS, PETPOSTEROUS_VISUAL_SYSTEMS } from "@shared/petposterousCreative";
import AdminLayout from "@/components/admin-layout";
import { ProductMockup } from "@/components/designer/ProductMockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/queryClient";
import { MockupBulkImport } from "@/pages/admin/MockupBulkImport";
import { EditColours } from "@/components/admin/EditColours";
import { FindMySizeButton } from "@/components/FindMySizeDialog";
import type { FindMySizeGuide } from "@shared/findMySize";

type ColourReading = {
  name: string;
  hex: string;
  minClear: number;
  eligible: boolean;
};

type SceneColour = { id: string; name: string; hex: string; kind: "produced" | "white-master" };
type SceneGroup = { panelId: string; label: string; isDefault: boolean; hasWhiteMaster?: boolean; colours: SceneColour[] };
type TickedColour = { name: string; hex: string };

type PendingCandidate = {
  id: string;
  status: string;
  dropReason?: string;
  canDelete?: boolean;
  title: string;
  description?: string;
  shopifyProductId: string | null;
  productUrl?: string | null;
  catalogueShop?: string;
  printifyShopId?: string | null;
  spendUsd?: number;
  spendLines?: Array<{ label: string; usd: number; estimated: boolean }>;
  sizes: string[];
  pricesBySize: Record<string, string>;
  compareAtBySize?: Record<string, string>;
  colors: Array<{ name: string; hex: string }>;
  colourTickMode?: "all" | "stored";
  selectedColor: string;
  selectedSize: string;
  eligibility: ColourReading[] | null;
  colourSizes: Record<string, string>;
  scenes: SceneGroup[];
  choice: { panelId: string | null; selectedColors: TickedColour[]; artworkPath: string | null };
  recentScenes: string[];
  productTypeId: number;
  sceneRecolourFromLibrary?: boolean;
  productTypeName: string;
  productTypes?: Array<{ id: number; name: string }>;
  publishTypes?: Array<{
    id: number;
    name: string;
    published: boolean;
    productUrl: string | null;
    panelRows?: Array<{ panelId: string; isDefault: boolean }>;
    colors: Array<{ name: string; hex: string; hasProducedBlank: boolean; photographs?: Array<{ panelId: string; label: string }> }>;
  }>;
  pendingCount?: number;
  nextCandidateId?: string;
  recipe?: {
    artStyle: string;
    species: string;
    humourOperator: string;
    funnyTruth: string;
    deviceText: string;
    punchline: string;
    poseNote?: string;
    petMask?: {
      x: number;
      y: number;
      w: number;
      h: number;
      nudgeX: number;
      nudgeY: number;
      nudgeW: number;
      nudgeH: number;
      letteringOverlapsPet: boolean;
    } | null;
    behaviour: string;
    deviceStructure: string;
    darknessLevel: number;
    filename: string;
  } | null;
  generation?: CatalogueConceptGeneration | null;
  conceptEnabled?: boolean;
  myPetTestEnabled?: boolean;
  publishPrefs?: { myPetEnabled: boolean | null; colors: Record<string, string[]> } | null;
};

type PetTestResult = {
  artworkPath: string;
  prompt: string;
  model: string;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
};

type OfferedColour = {
  name: string;
  hex: string;
  path: "produced" | "white-master" | "recolour";
  missingHex?: boolean;
  hasProducedBlank?: boolean;
};

function approvedColourTick(row: { path: string }): boolean {
  return row.path === "produced" || row.path === "white-master";
}

function offeredColours(
  data: {
    colourTickMode?: string;
    colors: Array<{ name: string; hex: string; missingHex?: boolean; hasProducedBlank?: boolean; inUseBlank?: "produced" | "white-master" | null }>;
    productTypeId: number;
    sceneRecolourFromLibrary?: boolean;
  } | undefined,
  scene: SceneGroup | undefined,
): OfferedColour[] {
  if (!data) return [];
  if (data.colourTickMode === "blanks") {
    return data.colors.map((color) => {
      const hex = String(color.hex || "").replace(/^#/, "");
      const missingHex = Boolean(color.missingHex) || !/^[0-9A-Fa-f]{6}$/.test(hex);
      const inUse = color.inUseBlank === "white-master" || color.inUseBlank === "produced"
        ? color.inUseBlank
        : color.hasProducedBlank ? "produced" as const : null;
      return {
        name: color.name,
        hex: missingHex ? "" : hex.toUpperCase(),
        missingHex,
        hasProducedBlank: inUse != null,
        path: inUse === "white-master" ? "white-master" as const : inUse === "produced" ? "produced" as const : "recolour" as const,
      };
    });
  }
  return sceneColours(scene, data.colors, data.sceneRecolourFromLibrary === true);
}

function sceneColours(scene: SceneGroup | undefined, fallback: Array<{ name: string; hex: string }>, fromLibrary = false) {
  if (!scene) return [] as Array<{ name: string; hex: string; path: "produced" | "recolour" }>;
  const rows = scene.colours.map((c) => ({ name: c.name, hex: c.hex, path: "produced" as const }));
  const canRecolour = fromLibrary ? Boolean(scene.hasWhiteMaster) : scene.colours.some((c) => c.kind === "white-master");
  if (canRecolour) {
    for (const color of fallback) {
      if (!rows.some((row) => row.name.toLowerCase() === color.name.toLowerCase())) {
        rows.push({ name: color.name, hex: color.hex, path: "recolour" });
      }
    }
  }
  return sortCatalogueColours(rows);
}

const TRANSFORM = { scale: 1, x: 0, y: 0 };

const LAUNCH_STYLES = [
  { id: "vintage-engraving", label: "Vintage Engraving" },
  { id: "pen-ink", label: "Pen & Ink" },
  { id: "woodcut", label: "Woodcut" },
  { id: "retro-character", label: "Retro Character" },
  { id: "bold-type", label: "Bold Type" },
  { id: "folk-graphic", label: "Folk Graphic" },
];

const HUMOUR = Object.keys(PETPOSTEROUS_CONCEPT_FRAMEWORKS);
const HUMOR_TONES = PETPOSTEROUS_PROMPT_PROFILE.humorOptions;
const LOOKS = PETPOSTEROUS_VISUAL_SYSTEMS.filter((look) => look.compatibility.apparel !== "hidden");

type Override = "rule" | "eligible" | "ineligible";

type QueueRow = {
  id: string;
  title: string;
  punchline?: string;
  phase: string;
  label: string;
  error: string;
  done?: boolean;
};

const ACTIVE_JOB = new Set(["queued", "print", "listing", "mockups", "shopify"]);

function refusalLines(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => String(item || "").trim()).filter((line) => line && line !== "Publish stopped");
}

function refusalMessage(body: { error?: unknown; reasons?: unknown; message?: unknown }, status?: number): string {
  const reasons = refusalLines(body?.reasons);
  if (reasons.length) return reasons.join("\n");
  const error = refusalLines(body?.error);
  if (error.length) return error.join("\n");
  const message = refusalLines(body?.message);
  if (message.length) return message.join("\n");
  if (status) return `Publish stopped (${status})`;
  return "Publish stopped";
}

function ShopProductImport({ productTypeId }: { productTypeId: number }) {
  const pricesHref = `/admin/customizer-pages?resyncProductType=${productTypeId}`;
  return (
    <div className="mt-4 rounded-md border border-dashed p-3" data-testid="import-owned-type">
      <p className="mb-2 text-sm font-medium">Import a blueprint to this shop</p>
      <p className="text-sm text-muted-foreground">
        New products for this shop are imported from Customizer Pages. Create Page includes the pricing step, and a page cannot be saved while a retail price is blank or $0.00.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/admin/customizer-pages">
          <Button type="button" size="sm" data-testid="import-owned-submit">
            Create Page
          </Button>
        </Link>
        <Link href={pricesHref}>
          <Button type="button" size="sm" variant="outline" data-testid="import-owned-prices">
            Set prices for this product
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Field({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <label className="block space-y-1" id={id}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}

export default function CatalogueStudioPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("candidate") || "";
  const platform = useQuery<{ defaultProductTypeId?: number }>({
    queryKey: ["/api/platform/admin/status"],
  });
  const [studioTypeId, setStudioTypeId] = useState(0);
  const [typePinned, setTypePinned] = useState(false);
  useEffect(() => {
    if (typePinned) return;
    const next = platform.data?.defaultProductTypeId;
    if (next && next !== studioTypeId) setStudioTypeId(next);
  }, [platform.data?.defaultProductTypeId, studioTypeId, typePinned]);
  const pendingKey = requested
    ? `/api/platform/catalogue-studio/pending?candidate=${encodeURIComponent(requested)}&productTypeId=${studioTypeId}`
    : `/api/platform/catalogue-studio/pending?productTypeId=${studioTypeId}`;
  const candidate = useQuery<PendingCandidate>({
    queryKey: [pendingKey],
    enabled: studioTypeId > 0,
  });
  const panels = useQuery<{ scenes: SceneGroup[] }>({
    queryKey: ["/api/platform/catalogue-studio/panels", studioTypeId],
    enabled: studioTypeId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/platform/catalogue-studio/panels?productTypeId=${studioTypeId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load scenes");
      return res.json();
    },
  });
  const sizeGuide = useQuery<{ guide: FindMySizeGuide | null }>({
    queryKey: ["/api/storefront/find-my-size", studioTypeId, candidate.data?.catalogueShop],
    enabled: studioTypeId > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ productTypeId: String(studioTypeId) });
      if (candidate.data?.catalogueShop) params.set("shop", candidate.data.catalogueShop);
      const res = await fetch(`/api/storefront/find-my-size?${params}`);
      if (!res.ok) return { guide: null };
      return res.json();
    },
  });
  const openCandidateId = requested || (candidate.data?.id && candidate.data.id !== "pending-bed-etiquette" ? candidate.data.id : "");
  const published = useQuery<{ designProductId: string | null; myPetEnabled?: boolean | null }>({
    queryKey: ["/api/platform/catalogue-studio/design-colours", openCandidateId, studioTypeId],
    enabled: Boolean(openCandidateId) && studioTypeId > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ candidateId: openCandidateId, productTypeId: String(studioTypeId) });
      const res = await fetch(`/api/platform/catalogue-studio/design-colours?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the published design");
      return res.json();
    },
  });
  const jobs = useQuery<{ queue: QueueRow[] }>({
    queryKey: ["/api/platform/catalogue-studio/jobs"],
    queryFn: async () => {
      const res = await fetch("/api/platform/catalogue-studio/jobs", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the queue");
      return res.json();
    },
    refetchInterval: 2500,
  });
  const [size, setSize] = useState("L");
  const [color, setColor] = useState("White");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(true);

  const [behaviour, setBehaviour] = useState("");
  const [truth, setTruth] = useState("");
  const [wording, setWording] = useState("Bed Etiquette");
  const [wordingNote, setWordingNote] = useState("");
  const [poseNote, setPoseNote] = useState("");
  const [poseStatus, setPoseStatus] = useState("");
  const [nudgeX, setNudgeX] = useState("0");
  const [nudgeY, setNudgeY] = useState("0");
  const [nudgeW, setNudgeW] = useState("0");
  const [nudgeH, setNudgeH] = useState("0");
  const wordingDirty = useRef(false);
  const wordingSaved = useRef<string | null>(null);
  const wordingCandidate = useRef("");
  const poseCandidate = useRef("");
  const wordingRef = useRef(wording);
  const wordingSave = useRef<Promise<void>>(Promise.resolve());
  wordingRef.current = wording;
  const [device, setDevice] = useState("");
  const [deviceStructure, setDeviceStructure] = useState("");
  const [humour, setHumour] = useState("");
  const [darkness, setDarkness] = useState("");
  const [species, setSpecies] = useState("");
  const [conceptText, setConceptText] = useState("");
  const [humorTone, setHumorTone] = useState("");
  const [lookId, setLookId] = useState("");
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderError, setRenderError] = useState("");
  const renderLock = useRef(false);
  const [petBusy, setPetBusy] = useState(false);
  const [petError, setPetError] = useState("");
  const [petTest, setPetTest] = useState<PetTestResult | null>(null);
  const petLock = useRef(false);
  const petFileRef = useRef<HTMLInputElement | null>(null);
  const petDraw = useRef(1);
  const [styleId, setStyleId] = useState("");
  const [surface, setSurface] = useState("apparel");

  const [drawCount, setDrawCount] = useState(1);
  const [draw, setDraw] = useState(1);
  const [verdict, setVerdict] = useState<"pending" | "approved" | "dropped">("pending");
  const [dropReason, setDropReason] = useState("");
  const [dropError, setDropError] = useState("");
  const [publishError, setPublishError] = useState("");
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  const [publishTicks, setPublishTicks] = useState<Record<number, boolean>>({});
  const [publishColours, setPublishColours] = useState<Record<number, string[]>>({});
  const [myPetEnabled, setMyPetEnabled] = useState(true);
  const [queueTab, setQueueTab] = useState<CatalogueQueueTab>(() => readCatalogueQueueTab(
    typeof window === "undefined" ? null : window.localStorage.getItem("catalogue-studio-queue-tab"),
  ));
  const [queueQuery, setQueueQuery] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const publishSeed = useRef("");
  const publishSetupSave = useRef<Promise<void>>(Promise.resolve());
  const openCandidateRef = useRef("");
  const [spendUsd, setSpendUsd] = useState(0);
  const [spendLines, setSpendLines] = useState<Array<{ label: string; usd: number; estimated: boolean }>>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [panelId, setPanelId] = useState("");
  const [ticked, setTicked] = useState<TickedColour[]>([]);
  const [cellSource, setCellSource] = useState<"" | "produced" | "recolour">("");
  const [printifyUrl, setPrintifyUrl] = useState<string | null>(null);
  const [printifyBusy, setPrintifyBusy] = useState(false);
  const [printifyError, setPrintifyError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [confirmUpload, setConfirmUpload] = useState<{ uploadId: string; maskPngBase64: string; photoDataUrl: string } | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [sceneLabel, setSceneLabel] = useState("");
  const [uploadColor, setUploadColor] = useState("White");
  const [uploadHex, setUploadHex] = useState("FFFFFF");
  const [uploadKind, setUploadKind] = useState<"produced" | "white-master">("white-master");
  const [uploadDefault, setUploadDefault] = useState(false);

  useEffect(() => {
    const list = candidate.data?.sizes;
    if (!list?.length || list.includes(size)) return;
    const preferred = candidate.data?.selectedSize;
    setSize(preferred && list.includes(preferred) ? preferred : list[0]);
  }, [candidate.data, size]);

  useEffect(() => {
    const recipe = candidate.data?.recipe;
    if (!candidate.data?.id || !recipe) return;
    setBehaviour(recipe.behaviour || "");
    setTruth(recipe.funnyTruth || "");
    const serverWording = recipe.punchline || "";
    if (wordingCandidate.current !== candidate.data.id) {
      wordingDirty.current = false;
      wordingSaved.current = null;
      wordingCandidate.current = candidate.data.id;
      setWording(serverWording);
      setWordingNote("");
    } else if (!wordingDirty.current) {
      setWording(wordingSaved.current != null ? wordingSaved.current : serverWording);
    }
    if (poseCandidate.current !== candidate.data.id) {
      poseCandidate.current = candidate.data.id;
      setPoseNote(recipe.poseNote || "");
      setPoseStatus("");
      const mask = recipe.petMask;
      setNudgeX(String(mask?.nudgeX ?? 0));
      setNudgeY(String(mask?.nudgeY ?? 0));
      setNudgeW(String(mask?.nudgeW ?? 0));
      setNudgeH(String(mask?.nudgeH ?? 0));
    }
    setDevice(recipe.deviceText || "");
    setDeviceStructure(recipe.deviceStructure || "");
    setHumour(recipe.humourOperator || "");
    setDarkness(recipe.darknessLevel ? String(recipe.darknessLevel) : "");
    setSpecies(recipe.species || "");
    setConceptText(candidate.data.generation?.concept || "");
    setHumorTone(candidate.data.generation?.humor || "");
    setLookId(candidate.data.generation?.look || "");
    setStyleId(recipe.artStyle || "");
    setPanelId("");
    setTicked([]);
    setVerdict(candidate.data.status === "dropped" ? "dropped" : candidate.data.status === "pending" ? "pending" : "approved");
    setDropReason(candidate.data.dropReason || "");
    setDropError("");
    setPublishError("");
    setPublishBusy(false);
    setPetTest(null);
    setPetError("");
    petDraw.current = 1;
  }, [candidate.data?.id, candidate.data?.status]);

  openCandidateRef.current = candidate.data?.id || "";

  function savedPublishColours(type: NonNullable<PendingCandidate["publishTypes"]>[number]): string[] {
    const offered = type.colors.filter((color) => color.hasProducedBlank).map((color) => color.name);
    return publishColourNames(candidate.data?.publishPrefs?.colors?.[String(type.id)], offered);
  }

  useEffect(() => {
    const id = candidate.data?.id;
    const types = candidate.data?.publishTypes;
    if (!id || !types) return;
    const reset = publishSeed.current !== id;
    if (reset) {
      publishSeed.current = id;
      setPublishNote("");
      setMyPetEnabled(candidate.data?.publishPrefs?.myPetEnabled !== false);
      const ticks: Record<number, boolean> = {};
      const colours: Record<number, string[]> = {};
      for (const type of types) {
        if (type.published) continue;
        ticks[type.id] = true;
        colours[type.id] = savedPublishColours(type);
      }
      setPublishTicks(ticks);
      setPublishColours(colours);
      return;
    }
    setPublishTicks((current) => {
      let changed = false;
      const next = { ...current };
      for (const type of types) {
        if (type.published || type.id in next) continue;
        next[type.id] = true;
        changed = true;
      }
      return changed ? next : current;
    });
    setPublishColours((current) => {
      let changed = false;
      const next = { ...current };
      for (const type of types) {
        if (type.published || next[type.id]) continue;
        next[type.id] = savedPublishColours(type);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [candidate.data?.id, candidate.data?.publishTypes, candidate.data?.publishPrefs]);

  useEffect(() => {
    if (!published.data?.designProductId || published.data.myPetEnabled == null) return;
    setMyPetEnabled(published.data.myPetEnabled !== false);
  }, [candidate.data?.id, published.data?.designProductId, published.data?.myPetEnabled]);

  const jobPhase = jobs.data?.queue.find((row) => row.id === candidate.data?.id)?.phase || "";
  const seenJobPhase = useRef("");
  useEffect(() => {
    if (!jobPhase || jobPhase === seenJobPhase.current) return;
    const previous = seenJobPhase.current;
    seenJobPhase.current = jobPhase;
    if (previous && (jobPhase === "done" || jobPhase === "failed")) {
      void candidate.refetch();
      void published.refetch();
    }
  }, [jobPhase, candidate, published]);

  useEffect(() => {
    setSpendUsd(candidate.data?.spendUsd || 0);
    setSpendLines(candidate.data?.spendLines || []);
  }, [candidate.data?.id, candidate.data?.productUrl, candidate.data?.spendUsd, candidate.data?.spendLines]);

  useEffect(() => {
    setPanelId("");
    setTicked([]);
  }, [studioTypeId]);

  useEffect(() => {
    const scenes = candidate.data?.scenes;
    if (!scenes?.length || panelId) return;
    const stored = candidate.data?.choice.panelId;
    const next = stored && scenes.some((scene) => scene.panelId === stored)
      ? stored
      : scenes.find((scene) => scene.isDefault)?.panelId || scenes[0].panelId;
    const scene = scenes.find((row) => row.panelId === next);
    const available = offeredColours(candidate.data, scene);
    const storedColours = candidate.data?.choice.selectedColors ?? [];
    const availableNames = new Set(available.map((row) => row.name.toLowerCase()));
    const storedIsForThisList = storedColours.length > 0
      && storedColours.every((row) => availableNames.has(row.name.toLowerCase()));
    const matched = storedIsForThisList ? initialTickedColours(storedColours, available) : [];
    const ticks = (matched.length ? matched : available.filter((row) => approvedColourTick(row)))
      .map(({ name, hex }) => ({ name, hex }));
    setPanelId(next);
    setTicked(ticks);
    setColor((current) => (ticks.some((tick) => tick.name === current) ? current : ticks[0]?.name || available[0]?.name || current));
    if (!matched.length) {
      void fetch("/api/platform/catalogue-studio/choice", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.data?.id, panelId: next, selectedColors: ticks }),
      });
    }
  }, [candidate.data, panelId]);

  useEffect(() => {
    if (!panelId) return;
    let url: string | null = null;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    setPreviewUrl(null);
    setPreviewError(null);
    setCellSource("");
    (async () => {
      const draws = candidate.data?.generation?.draws || [];
      const selected = draws[Math.max(0, draw - 1)];
      const drawQuery = selected ? `&draw=${encodeURIComponent(selected.id)}` : "";
      const idQuery = candidate.data?.id ? `&candidate=${encodeURIComponent(candidate.data.id)}` : "";
      const petOn = published.data?.designProductId ? published.data.myPetEnabled !== false : myPetEnabled;
      const petQuery = !showAdmin && petOn && petTest?.artworkPath
        ? `&petArtwork=${encodeURIComponent(petTest.artworkPath)}`
        : "";
      const res = await apiFetch(
        `/api/platform/catalogue-studio/pending-preview?color=${encodeURIComponent(color)}&panelId=${encodeURIComponent(panelId)}&productTypeId=${studioTypeId}${idQuery}${drawQuery}${petQuery}`,
        { signal: controller.signal, transport: "xhr" },
      );
      if (res.status === 204) {
        if (!cancelled) {
          setCellSource("");
          setPreviewError(null);
          setPreviewUrl(null);
        }
        return;
      }
      if (!res.ok) {
        if (!cancelled) {
          const text = await res.text();
          let message = text;
          try {
            const body = JSON.parse(text) as { error?: string; message?: string };
            message = body.error || body.message || text;
          } catch { /* the body is already plain text */ }
          setCellSource("");
          setPreviewUrl(null);
          setPreviewError(message.slice(0, 500) || "The mockup preview did not load.");
        }
        return;
      }
      const source = res.headers.get("X-Mockup-Source");
      url = URL.createObjectURL(await res.blob());
      if (!cancelled) {
        setPreviewError(null);
        setPreviewUrl(url);
        setCellSource(source === "produced" || source === "recolour" ? source : "");
      }
    })().catch((e) => {
      if (cancelled) return;
      setPreviewUrl(null);
      setCellSource("");
      setPreviewError(e?.name === "AbortError" ? "The mockup preview timed out." : String(e?.message || e));
    }).finally(() => {
      window.clearTimeout(timer);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [color, panelId, previewNonce, candidate.data?.id, candidate.data?.generation, studioTypeId, draw, showAdmin, myPetEnabled, published.data?.designProductId, published.data?.myPetEnabled, petTest?.artworkPath]);

  useEffect(() => {
    if (petDraw.current === draw) return;
    petDraw.current = draw;
    setPetTest(null);
  }, [draw]);

  useEffect(() => {
    if (!showAdmin) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setDraw((current) => {
        const count = Math.max(1, candidate.data?.generation?.draws.length || drawCount);
        const next = event.key === "ArrowRight" ? current + 1 : current - 1;
        if (next < 1) return count;
        if (next > count) return 1;
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdmin, drawCount, candidate.data?.generation?.draws.length]);

  async function runPetTest(file: File | undefined) {
    const petOn = published.data?.designProductId ? published.data.myPetEnabled !== false : myPetEnabled;
    if (!file || petLock.current || !candidate.data?.myPetTestEnabled || !petOn) return;
    if (file.size > 15 * 1024 * 1024) {
      setPetError("Photo is too large");
      if (petFileRef.current) petFileRef.current.value = "";
      return;
    }
    petLock.current = true;
    const requestId = crypto.randomUUID();
    setPetBusy(true);
    setPetError("");
    try {
      const imageData = await fileToDataUrl(file);
      const draws = candidate.data.generation?.draws || [];
      const selected = draws[Math.max(0, draw - 1)];
      const res = await apiFetch("/api/platform/catalogue-studio/my-pet-test", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          candidateId: candidate.data.id,
          imageData,
          drawId: selected?.id || "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error || "My Pet test failed"));
      setPetTest({
        artworkPath: String(body.artworkPath || ""),
        prompt: String(body.prompt || ""),
        model: String(body.model || ""),
        estimatedCostUsd: body.estimatedCostUsd == null ? null : Number(body.estimatedCostUsd),
        actualCostUsd: body.actualCostUsd == null ? null : Number(body.actualCostUsd),
      });
      if (typeof body.spendUsd === "number") setSpendUsd(body.spendUsd);
      if (Array.isArray(body.spendLines)) setSpendLines(body.spendLines);
    } catch (e: any) {
      setPetError(String(e?.message || e));
    } finally {
      petLock.current = false;
      setPetBusy(false);
      if (petFileRef.current) petFileRef.current.value = "";
    }
  }

  async function redrawCandidate() {
    if (renderLock.current) return;
    if (!candidate.data?.generation?.concept) return;
    renderLock.current = true;
    const requestId = crypto.randomUUID();
    setRenderBusy(true);
    setRenderError("");
    try {
      const res = await apiFetch("/api/platform/catalogue-studio/concept/redraw", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          candidateId: candidate.data.id,
          concept: conceptText,
          species,
          humor: humorTone,
          look: lookId,
          wordsMode: wording.trim() ? "exact" : "none",
          exactWords: wording,
          draws: Math.min(4, Math.max(1, drawCount)),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(body.error || "Re-render failed"));
      const count = Array.isArray(body.draws) ? body.draws.length : 0;
      if (count) setDraw(count);
      if (body.error) setRenderError(String(body.error));
      await candidate.refetch();
    } catch (e: any) {
      setRenderError(String(e?.message || e));
    } finally {
      renderLock.current = false;
      setRenderBusy(false);
    }
  }

  const sizes = candidate.data?.sizes ?? [];
  const salePrice = candidate.data?.pricesBySize?.[size] || "";
  const compareAtPrice = candidate.data?.compareAtBySize?.[size] || "";
  const scene = candidate.data?.scenes.find((row) => row.panelId === panelId);
  const offered = offeredColours(candidate.data, scene);
  const active = offered.find((c) => c.name === color) ?? candidate.data?.colors.find((c) => c.name === color);
  const readings = candidate.data?.eligibility;

  const hero = previewUrl ? (
    <ProductMockup
      mockupUrl={previewUrl}
      mockupFit="contain"
      designerType="apparel"
      transform={TRANSFORM}
      onTransformChange={() => {}}
      enableDrag={false}
    />
  ) : (
    <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {candidate.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !panelId ? "No panel is stored yet." : previewError ? previewError : <Loader2 className="h-5 w-5 animate-spin" />}
    </div>
  );

  const queue = (jobs.data?.queue ?? []).map((row) => ({
    ...row,
    punchline: row.punchline || "",
    done: row.done ?? (row.phase === "done" || row.label === "Done"),
  }));
  const queueCounts = catalogueQueueCounts(queue);
  const visibleQueue = filterCatalogueQueue(queue, queueTab, queueQuery);
  const queueSlice = catalogueQueuePage(visibleQueue, queuePage);
  const job = queue.find((row) => row.id === candidate.data?.id);
  const jobActive = ACTIVE_JOB.has(job?.phase || "");
  const publishLabel = jobActive ? job?.label || "Queued" : "Promote and publish";
  const listedNames = (candidate.data?.publishTypes || []).filter((type) => type.published).map((type) => type.name);
  const openPublishTypes = (candidate.data?.publishTypes || []).filter((type) => !type.published);

  async function savePose() {
    const id = candidate.data?.id;
    if (!id || candidate.data?.status === "dropped") return;
    const res = await apiFetch("/api/platform/catalogue-studio/pet-pose", {
      method: "POST",
      body: JSON.stringify({
        candidateId: id,
        poseNote,
        nudgeX: Number(nudgeX),
        nudgeY: Number(nudgeY),
        nudgeW: Number(nudgeW),
        nudgeH: Number(nudgeH),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setPoseStatus(res.ok ? "Saved" : String(body.error || body.message || "Not saved"));
  }

  async function saveWording() {
    const value = wordingRef.current;
    const id = candidate.data?.id;
    if (!wordingDirty.current || !id || !catalogueDesignCanBeEdited(candidate.data?.status)) return;
    const run = wordingSave.current.catch(() => undefined).then(async () => {
      if (!wordingDirty.current || wordingRef.current !== value) return;
      const res = await apiFetch("/api/platform/catalogue-studio/punchline", {
        method: "POST",
        body: JSON.stringify({ candidateId: id, punchline: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWordingNote(String(body.error || body.message || "Not saved"));
        return;
      }
      if (wordingRef.current !== value) return;
      wordingSaved.current = value;
      wordingDirty.current = false;
      setWordingNote("Saved");
    });
    wordingSave.current = run;
    await run;
  }

  function savePublishSetup(id: string, body: { productTypeId?: number; colorNames?: string[]; myPetEnabled?: boolean }) {
    if (!id || !catalogueDesignCanBeEdited(candidate.data?.status) || candidate.data?.id !== id) return;
    const run = publishSetupSave.current.catch(() => undefined).then(async () => {
      const res = await apiFetch("/api/platform/catalogue-studio/publish-setup", {
        method: "POST",
        body: JSON.stringify({ candidateId: id, ...body }),
      });
      const saved = await res.json().catch(() => ({}));
      if (openCandidateRef.current !== id) return;
      if (!res.ok) {
        setPublishNote(String(saved.error || saved.message || "Not saved"));
        return;
      }
      setPublishNote("Saved");
    });
    publishSetupSave.current = run;
  }

  async function saveMyPet(next: boolean) {
    setMyPetEnabled(next);
    setPublishNote("");
    const id = candidate.data?.id;
    const designProductId = published.data?.designProductId;
    if (designProductId) {
      const res = await apiFetch("/api/platform/catalogue-studio/my-pet", {
        method: "POST",
        body: JSON.stringify({ designProductId, enabled: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishNote(String(body.error || body.message || "Not saved"));
        return;
      }
      void published.refetch();
    }
    if (id && catalogueDesignCanBeEdited(candidate.data?.status)) {
      savePublishSetup(id, { myPetEnabled: next });
    }
  }

  function chooseQueueTab(next: CatalogueQueueTab) {
    setQueueTab(next);
    setQueuePage(1);
    try {
      window.localStorage.setItem("catalogue-studio-queue-tab", next);
    } catch {
      /* the queue still works if the browser refuses storage */
    }
  }

  async function publishCandidate() {
    setPublishError("");
    setDropError("");
    setPublishBusy(true);
    try {
      await wordingSave.current;
      if (wordingDirty.current) await saveWording();
      await publishSetupSave.current;
      const savedWording = wordingRef.current;
      const res = await apiFetch("/api/platform/catalogue-studio/publish", {
        method: "POST",
        body: JSON.stringify({
          candidateId: candidate.data?.id,
          panelId,
          selectedColors: ticked,
          artStyle: styleId,
          species,
          humourOperator: humour,
          punchline: savedWording,
          title: savedWording,
          behaviour,
          funnyTruth: truth,
          deviceText: device,
          deviceStructure,
          darknessLevel: Number(darkness),
          productTypeId: studioTypeId,
          myPetEnabled,
          targets: (candidate.data?.publishTypes || [])
            .filter((type) => !type.published && publishTicks[type.id])
            .map((type) => ({
              productTypeId: type.id,
              selectedColors: type.colors
                .filter((color) => color.hasProducedBlank && (publishColours[type.id] || []).includes(color.name))
                .map((color) => ({ name: color.name, hex: color.hex })),
            })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = refusalMessage(body, res.status);
        console.error("[catalogue-studio] publish failed", message);
        setPublishError(message);
        return;
      }
      await jobs.refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || "");
      setPublishError(message || "Publish stopped");
    } finally {
      setPublishBusy(false);
    }
  }

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {candidate.data?.catalogueShop ? `${candidate.data.catalogueShop}` : ""}
          {candidate.data?.printifyShopId ? ` · Printify ${candidate.data.printifyShopId}` : ""}
          {candidate.data?.catalogueShop ? " · " : ""}
          {candidate.data?.recipe?.filename || (candidate.data?.status === "approved" ? "Approved candidate" : "Pending candidate")}. {listedNames.length ? `Listed on ${listedNames.join(", ")}.` : "No Shopify product."}
          {candidate.data?.pendingCount ? ` ${candidate.data.pendingCount} in the queue.` : ""}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdmin((v) => !v)}>
          {showAdmin ? "Simulate customer" : "Show operator panel"}
        </Button>
      </div>
      <div className="mb-6 rounded-md border p-4" data-testid="catalogue-studio-panels">
        <label className="mb-3 block text-sm">
          Product type{" "}
          <select
            className="ml-1 rounded-md border bg-background px-2 py-1"
            value={studioTypeId}
            data-testid="catalogue-studio-type"
            onChange={(event) => {
              setTypePinned(true);
              setStudioTypeId(Number(event.target.value));
            }}
          >
            {(candidate.data?.productTypes?.length ? candidate.data.productTypes : [{ id: studioTypeId, name: candidate.data?.productTypeName || "Unisex Softstyle T-Shirt" }]).map((type) => (
              <option key={type.id} value={type.id}>{type.name} ({type.id})</option>
            ))}
          </select>
        </label>
        <ShopProductImport productTypeId={studioTypeId} />
        <MockupBulkImport
          productType={candidate.data ? { id: candidate.data.productTypeId, name: candidate.data.productTypeName } : null}
          storedScenes={(panels.data?.scenes ?? []).map((scene) => scene.panelId)}
          onImported={() => Promise.all([candidate.refetch(), panels.refetch()])}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Panels on file: {panels.data ? panels.data.scenes.length : "…"}
          {" · "}
          <Link href="/admin/catalogue-studio/colour-blanks" className="underline" data-testid="colour-blanks-link">
            Colour blanks
          </Link>
        </p>
      </div>
      <div className={showAdmin ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]" : ""}>
        <div>
          <div className="grid gap-8 md:grid-cols-2">
            <div data-testid="catalogue-studio-hero">
              <div className={printifyUrl ? "grid gap-3 sm:grid-cols-2" : ""}>
                <div className="mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-md bg-white">
                  {hero}
                </div>
                {printifyUrl ? (
                  <div>
                    <div className="mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-md bg-white">
                      <img src={printifyUrl} alt="" className="h-full w-full object-contain" />
                    </div>
                    <p className="mt-2 text-center text-xs text-muted-foreground">placement preview, not print resolution</p>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={printifyBusy || !panelId}
                  onClick={() => {
                    setPrintifyBusy(true);
                    setPrintifyError("");
                    void apiFetch("/api/platform/catalogue-studio/printify-preview", {
                      method: "POST",
                      body: JSON.stringify({ candidateId: candidate.data?.id, panelId, color, size, productTypeId: studioTypeId }),
                    }).then(async (res) => {
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(body.error || "Printify did not return a mockup.");
                      setPrintifyUrl(String(body.mockupUrl || ""));
                    }).catch((e: any) => {
                      setPrintifyError(String(e?.message || e));
                    }).finally(() => setPrintifyBusy(false));
                  }}
                >
                  {printifyBusy ? "Asking Printify" : "Preview on Printify"}
                </Button>
              </div>
              {printifyError ? <p className="mt-2 text-center text-xs">{printifyError}</p> : null}
              <div className="mt-3 flex items-center justify-center gap-2">
                <button type="button" className="h-14 w-14 overflow-hidden rounded border-2 border-foreground" aria-current="true">
                  {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-contain" /> : null}
                </button>
              </div>
            </div>
            <div className="space-y-4">
              <h1 className="text-2xl font-semibold">{candidate.data?.title || "Pending candidate"}</h1>
              {candidate.data?.description ? <p className="text-sm text-muted-foreground">{candidate.data.description}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {sizes.map((s) => (
                    <Button key={s} type="button" size="sm" variant={size === s ? "default" : "outline"} onClick={() => setSize(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <FindMySizeButton
                  guide={sizeGuide.data?.guide}
                  onUseSize={(name) => setSize(name)}
                />
              </div>
              <p className="text-sm">{active?.name || color}</p>
              {cellSource ? (
                <p className="text-sm" data-testid="catalogue-studio-cell-source">{cellSource}</p>
              ) : null}
              <div className="flex gap-2" data-testid="catalogue-studio-swatch-strip">
                {offered.filter((c) => ticked.some((tick) => tick.name === c.name) && !c.missingHex).map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    aria-label={c.name}
                    title={c.name}
                    onClick={() => setColor(c.name)}
                    className="h-8 w-8 rounded-full border"
                    style={{
                      background: `#${c.hex}`,
                      outline: color === c.name ? "2px solid currentColor" : undefined,
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
              <p className="text-lg" data-testid="catalogue-studio-price">
                {compareAtPrice ? <span className="mr-2 text-muted-foreground line-through">${compareAtPrice}</span> : null}
                {salePrice ? `$${salePrice}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">Shipping calculated at checkout</p>
              {!showAdmin && (published.data?.designProductId ? published.data.myPetEnabled !== false : myPetEnabled) && candidate.data?.myPetTestEnabled ? (
                <div className="space-y-2" data-testid="catalogue-my-pet-test">
                  <input
                    ref={petFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      void runPetTest(file);
                    }}
                  />
                  <Button
                    type="button"
                    className="w-full"
                    disabled={petBusy || !panelId}
                    onClick={() => petFileRef.current?.click()}
                  >
                    {petBusy ? "Making your pet" : "My Pet"}
                  </Button>
                  {petError ? <p className="text-xs">{petError}</p> : null}
                  {petTest ? (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {petTest.model} · estimated {petTest.estimatedCostUsd == null ? "—" : formatCatalogueSpend(petTest.estimatedCostUsd)}
                        {" · "}actual {petTest.actualCostUsd == null ? "—" : formatCatalogueSpend(petTest.actualCostUsd)}
                      </p>
                      <details>
                        <summary>Prompt sent</summary>
                        <pre className="mt-1 whitespace-pre-wrap text-xs">{petTest.prompt}</pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <Button type="button" className="w-full" disabled>Add to cart</Button>
              <p className="text-xs text-muted-foreground">Guarantee · rating · returns · shipping</p>
              <Accordion type="multiple">
                <AccordionItem value="comfort">
                  <AccordionTrigger>Comfort</AccordionTrigger>
                  <AccordionContent>Product-type copy is supplied with the candidate. Nothing is published.</AccordionContent>
                </AccordionItem>
                <AccordionItem value="durability">
                  <AccordionTrigger>Durability</AccordionTrigger>
                  <AccordionContent>Product-type copy is supplied with the candidate. Nothing is published.</AccordionContent>
                </AccordionItem>
                <AccordionItem value="returns">
                  <AccordionTrigger>Returns</AccordionTrigger>
                  <AccordionContent>Product-type copy is supplied with the candidate. Nothing is published.</AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-medium">Related products</h2>
            <p className="text-sm text-muted-foreground">
              {(candidate.data?.pendingCount || 0) > 1
                ? `${(candidate.data?.pendingCount || 1) - 1} other designs in the queue.`
                : "No other designs in the queue."}
              {candidate.data?.nextCandidateId ? (
                <>
                  {" "}
                  <Link href={`/admin/catalogue-studio?candidate=${candidate.data.nextCandidateId}`}>Next</Link>
                </>
              ) : null}
            </p>
          </section>
        </div>
        {showAdmin ? (
          <aside className="max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto rounded-md border p-4 text-sm xl:sticky xl:top-4">
            <div>
              <p className="font-medium">Candidate {candidate.data?.id || "pending-bed-etiquette"}</p>
              <p>Status: {verdict}</p>
            </div>
            <section className="space-y-2" data-testid="catalogue-studio-queue">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Queue filter">
                {(["pending", "done", "all"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={queueTab === tab}
                    data-testid={`catalogue-queue-tab-${tab}`}
                    className={`rounded-md border px-2 py-1 text-xs ${queueTab === tab ? "bg-muted font-medium" : ""}`}
                    onClick={() => chooseQueueTab(tab)}
                  >
                    {tab === "pending" ? "Pending" : tab === "done" ? "Done" : "All"} ({queueCounts[tab]})
                  </button>
                ))}
              </div>
              <Input
                value={queueQuery}
                placeholder="Search title or wording"
                aria-label="Search the queue"
                data-testid="catalogue-queue-search"
                onChange={(event) => {
                  setQueueQuery(event.target.value);
                  setQueuePage(1);
                }}
              />
              <h2 className="font-medium">Queue</h2>
              {queueSlice.rows.length ? (
                <ul className="space-y-1">
                  {queueSlice.rows.map((row) => (
                    <li key={row.id}>
                      <Link href={`/admin/catalogue-studio?candidate=${encodeURIComponent(row.id)}`} className="underline">
                        {row.title || row.id}
                      </Link>
                      {row.label ? <span className="text-muted-foreground"> · {row.label}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{queueQuery.trim() ? "No designs match." : "No designs in this tab."}</p>
              )}
              {queueSlice.pages > 1 ? (
                <div className="flex items-center gap-2 text-xs">
                  <button type="button" className="underline disabled:no-underline disabled:opacity-40" disabled={queueSlice.page <= 1} onClick={() => setQueuePage(queueSlice.page - 1)}>Previous</button>
                  <span>{queueSlice.page} of {queueSlice.pages}</span>
                  <button type="button" className="underline disabled:no-underline disabled:opacity-40" disabled={queueSlice.page >= queueSlice.pages} onClick={() => setQueuePage(queueSlice.page + 1)}>Next</button>
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">Recipe</h2>
              {candidate.data?.conceptEnabled ? (
                <>
                  <Field label="Concept">
                    <Textarea value={conceptText} onChange={(e) => setConceptText(e.target.value)} placeholder="The visual joke" />
                  </Field>
                  <Field label="Humour">
                    <select className="h-9 w-full rounded-md border bg-background px-2" value={humorTone} onChange={(e) => setHumorTone(e.target.value)}>
                      <option value="">Not chosen</option>
                      {HUMOR_TONES.map((tone) => (
                        <option key={tone.id} value={tone.id}>{tone.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="LOOK">
                    <select className="h-9 w-full rounded-md border bg-background px-2" value={lookId} onChange={(e) => setLookId(e.target.value)}>
                      <option value="">Not chosen</option>
                      {LOOKS.map((look) => (
                        <option key={look.id} value={look.id}>{look.label}</option>
                      ))}
                    </select>
                  </Field>
                </>
              ) : null}
              <Field label="Behaviour" id="studio-recipe-behaviour">
                <Textarea value={behaviour} onChange={(e) => setBehaviour(e.target.value)} placeholder="Not written" />
              </Field>
              <Field label="Truth">
                <Textarea value={truth} onChange={(e) => setTruth(e.target.value)} placeholder="Not written" />
              </Field>
              <Field label="Exact wording">
                <Input
                  value={wording}
                  onChange={(e) => {
                    wordingDirty.current = true;
                    setWordingNote("");
                    setWording(e.target.value);
                  }}
                  onBlur={() => void saveWording()}
                />
                {wordingNote ? <p className="text-xs text-muted-foreground" data-testid="catalogue-studio-wording-note">{wordingNote}</p> : null}
              </Field>
              <Field label="Design pose">
                <Textarea
                  value={poseNote}
                  data-testid="catalogue-studio-pose-note"
                  onChange={(e) => setPoseNote(e.target.value)}
                  onBlur={() => void savePose()}
                  placeholder="Which body parts the design shows"
                />
                {candidate.data?.recipe?.petMask?.letteringOverlapsPet ? (
                  <p className="text-xs text-muted-foreground" data-testid="catalogue-studio-lettering-overlap">
                    Lettering sits on the pet, so that part is inside the mask and can still be redrawn.
                  </p>
                ) : null}
                {poseStatus ? <p className="text-xs text-muted-foreground">{poseStatus}</p> : null}
              </Field>
              <Field label="Pet area nudge">
                <div className="grid grid-cols-4 gap-2">
                  <Input aria-label="Nudge left" value={nudgeX} onChange={(e) => setNudgeX(e.target.value)} onBlur={() => void savePose()} />
                  <Input aria-label="Nudge up" value={nudgeY} onChange={(e) => setNudgeY(e.target.value)} onBlur={() => void savePose()} />
                  <Input aria-label="Nudge width" value={nudgeW} onChange={(e) => setNudgeW(e.target.value)} onBlur={() => void savePose()} />
                  <Input aria-label="Nudge height" value={nudgeH} onChange={(e) => setNudgeH(e.target.value)} onBlur={() => void savePose()} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Left, up, width, height, as fractions of the artwork. The detected pet box stays. This only moves it.
                </p>
              </Field>
              <Field label="Device">
                <Input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Not written" />
              </Field>
              <Field label="Device structure">
                <Input value={deviceStructure} onChange={(e) => setDeviceStructure(e.target.value)} placeholder="Not written" />
              </Field>
              <Field label="Humour operator">
                <select className="h-9 w-full rounded-md border bg-background px-2" value={humour} onChange={(e) => setHumour(e.target.value)}>
                  <option value="">Not chosen</option>
                  {HUMOUR.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </Field>
              <Field label="Darkness">
                <Input value={darkness} onChange={(e) => setDarkness(e.target.value)} placeholder="Not set" />
              </Field>
              <Field label="Species">
                <Input value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="Not set" />
              </Field>
              <Field label="Style">
                <select className="h-9 w-full rounded-md border bg-background px-2" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                  <option value="">Not chosen</option>
                  {LAUNCH_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Surface">
                <select className="h-9 w-full rounded-md border bg-background px-2" value={surface} onChange={(e) => setSurface(e.target.value)}>
                  <option value="apparel">Apparel</option>
                  <option value="decor">Decor</option>
                </select>
              </Field>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!candidate.data?.conceptEnabled || !candidate.data?.generation?.concept || renderBusy}
                onClick={() => void redrawCandidate()}
              >
                {renderBusy ? "Rendering" : "Re-render"}
              </Button>
              {candidate.data?.conceptEnabled ? (
                <p className="text-xs text-muted-foreground">
                  {candidate.data.generation?.concept
                    ? "Re-render uses this concept, species, humour, LOOK and exact wording. New draws are added to this candidate."
                    : "This candidate has no saved concept. Start one from Catalogue import."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Generation is not connected. Editing stays on this page.</p>
              )}
              {renderError ? <p className="text-xs">{renderError}</p> : null}
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">Style comparison</h2>
              <div className="grid grid-cols-2 gap-2">
                {LAUNCH_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyleId(s.id)}
                    className={`rounded border px-2 py-2 text-left text-xs ${styleId === s.id ? "border-foreground" : "border-border"}`}
                  >
                    {s.label}
                    <span className="mt-1 block text-muted-foreground">No render stored</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">The hero stays the pending artwork. A style choice does not invent a second image.</p>
            </section>

            <section className="space-y-2" data-testid="catalogue-studio-scenes">
              <h2 className="font-medium">Scene</h2>
              <p className="text-xs text-muted-foreground" data-testid="catalogue-studio-recent-scenes">
                Recent approvals: {candidate.data?.recentScenes.length ? candidate.data.recentScenes.join(" · ") : "None yet"}
              </p>
              <select
                className="h-9 w-full rounded-md border bg-background px-2"
                value={panelId}
                onChange={(e) => {
                  const next = e.target.value;
                  const nextScene = candidate.data?.scenes.find((row) => row.panelId === next);
                  const available = offeredColours(candidate.data, nextScene);
                  const kept = ticked.filter((tick) => available.some((row) => row.name === tick.name));
                  setPanelId(next);
                  setTicked(kept);
                  setColor((current) => (kept.some((row) => row.name === current) ? current : kept[0]?.name || available[0]?.name || current));
                  void fetch("/api/platform/catalogue-studio/choice", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ candidateId: candidate.data?.id, panelId: next, selectedColors: kept }),
                  });
                }}
              >
                {(candidate.data?.scenes || []).map((row) => (
                  <option key={row.panelId} value={row.panelId}>
                    {row.label}{row.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <ul className="space-y-1">
                {offered.map((row) => {
                  const on = ticked.some((tick) => tick.name === row.name);
                  const reading = readings?.find((item) => item.name === row.name);
                  return (
                    <li key={row.name}>
                      <label className="flex items-center justify-between gap-2">
                        <span>
                          <input
                            type="checkbox"
                            className="mr-2"
                            data-testid={`catalogue-studio-colour-${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                            checked={on}
                            onChange={() => {
                              const next = on
                                ? ticked.filter((tick) => tick.name !== row.name)
                                : [...ticked, { name: row.name, hex: row.hex }];
                              setTicked(next);
                              setColor((current) => (next.some((tick) => tick.name === current) ? current : next[0]?.name || current));
                              void fetch("/api/platform/catalogue-studio/choice", {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ candidateId: candidate.data?.id, panelId, selectedColors: next }),
                              });
                            }}
                          />
                          {row.missingHex ? (
                            <span className="mr-2 text-xs font-medium text-destructive">no hex</span>
                          ) : (
                            <span
                              aria-hidden
                              className="mr-2 inline-block h-3 w-3 rounded-full border border-border align-middle"
                              style={{ backgroundColor: `#${row.hex.replace(/^#/, "")}` }}
                            />
                          )}
                          {row.name}
                          {reading
                            ? ` ${(reading.minClear * 100).toFixed(1)}% ${reading.eligible ? "pass" : "fail"}`
                            : " no reading"}
                          <span className="ml-2 text-xs text-muted-foreground">{candidate.data?.colourSizes?.[row.name] || ""}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{row.path}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">Upload a panel</h2>
              <Field label="Scene name">
                <Input value={sceneLabel} onChange={(e) => setSceneLabel(e.target.value)} placeholder="Rope and sneakers" />
              </Field>
              <Field label="Garment colour">
                <Input value={uploadColor} onChange={(e) => setUploadColor(e.target.value)} />
              </Field>
              <Field label="Hex">
                <Input value={uploadHex} onChange={(e) => setUploadHex(e.target.value)} />
              </Field>
              <Field label="Kind">
                <select className="h-9 w-full rounded-md border bg-background px-2" value={uploadKind} onChange={(e) => setUploadKind(e.target.value as "produced" | "white-master")}>
                  <option value="white-master">White master</option>
                  <option value="produced">Produced colourway</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={uploadDefault} onChange={(e) => setUploadDefault(e.target.checked)} />
                Pre-select this scene
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploadError("");
                  const imageBase64 = await fileToDataUrl(file);
                  const res = await fetch("/api/platform/catalogue-studio/panels/prepare", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      label: sceneLabel || scene?.label || "",
                      panelId: sceneLabel ? undefined : panelId,
                      garmentColor: uploadColor,
                      garmentHex: uploadHex,
                      kind: uploadKind,
                      isDefault: uploadDefault,
                      imageBase64,
                    }),
                  });
                  const body = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setUploadError(body.error || "Upload failed");
                    return;
                  }
                  if (body.needsConfirm) {
                    setConfirmUpload({ uploadId: body.uploadId, maskPngBase64: body.maskPngBase64, photoDataUrl: imageBase64 });
                    return;
                  }
                  setConfirmUpload(null);
                  await candidate.refetch();
                  if (body.panelId) setPanelId(body.panelId);
                }}
              />
              <Field label="Candidate artwork">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const imageBase64 = await fileToDataUrl(file);
                    const res = await fetch("/api/platform/catalogue-studio/artwork", {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ candidateId: candidate.data?.id, imageBase64 }),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      setUploadError(body.error || "Artwork upload failed");
                      return;
                    }
                    setUploadError("");
                    setPreviewNonce((n) => n + 1);
                  }}
                />
              </Field>
              {confirmUpload ? (
                <MaskConfirm
                  maskPngBase64={confirmUpload.maskPngBase64}
                  photoDataUrl={confirmUpload.photoDataUrl}
                  onConfirm={async (maskPngBase64) => {
                    const res = await fetch("/api/platform/catalogue-studio/panels/confirm", {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ uploadId: confirmUpload.uploadId, maskPngBase64 }),
                    });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      setUploadError(body.error || "Confirm failed");
                      return;
                    }
                    setConfirmUpload(null);
                    await candidate.refetch();
                    if (body.panelId) setPanelId(body.panelId);
                    setPreviewNonce((n) => n + 1);
                  }}
                />
              ) : null}
              {uploadError ? <p className="text-xs">{uploadError}</p> : null}
              <p className="text-xs text-muted-foreground">Upload the white master first. A matching dark file is stored on its own. Anything else waits for the outline.</p>
            </section>

            <section className="space-y-2" data-testid="catalogue-studio-eligibility">
              <h2 className="font-medium">Colour eligibility</h2>
              <p className="text-xs text-muted-foreground">
                Weakest region of this artwork. Share of its pixels with dE2000 over 32. Legible at 15% or more. Guidance only — a fail can still be ticked. The size range is what that colour will carry.
              </p>
              {readings == null ? (
                <p className="text-muted-foreground">No reading for this artwork.</p>
              ) : (
                <ul className="space-y-2">
                  {readings.map((row) => {
                    const override = overrides[row.name] || "rule";
                    const eligible = override === "rule" ? row.eligible : override === "eligible";
                    return (
                      <li key={row.name} className="flex items-center justify-between gap-2">
                        <span className={eligible ? "" : "line-through"}>
                          {row.name} {(row.minClear * 100).toFixed(1)}% {row.eligible ? "pass" : "fail"}
                        </span>
                        <select
                          aria-label={`${row.name} override`}
                          className="h-8 rounded border bg-background px-1 text-xs"
                          value={override}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [row.name]: e.target.value as Override }))}
                        >
                          <option value="rule">Rule</option>
                          <option value="eligible">Force eligible</option>
                          <option value="ineligible">Force ineligible</option>
                        </select>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">Draws</h2>
              {candidate.data?.conceptEnabled && candidate.data.generation ? (
                <Field label="New draws">
                  <Input
                    type="number"
                    min={1}
                    max={4}
                    value={drawCount}
                    onChange={(e) => setDrawCount(Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
                  />
                </Field>
              ) : null}
              <p>Selected draw {draw} of {Math.max(1, candidate.data?.generation?.draws.length || 1)}. Arrow keys switch while this panel is open.</p>
              <p className="text-xs text-muted-foreground">Draw 1 stays the artwork used when you publish. Later draws are only shown here. Estimated is the text-input quote. Actual is the provider usage total, including the image.</p>
              {(candidate.data?.generation?.draws || []).map((row, index) => (
                <div key={row.id} className={draw === index + 1 ? "rounded border p-2" : "p-2"}>
                  <button type="button" className="underline" onClick={() => setDraw(index + 1)}>
                    Draw {index + 1}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {row.model} · estimated {row.estimatedCostUsd == null ? "—" : formatCatalogueSpend(row.estimatedCostUsd)}
                    {" · "}actual {row.actualCostUsd == null ? "—" : formatCatalogueSpend(row.actualCostUsd)}
                  </p>
                  <details>
                    <summary>Prompt sent</summary>
                    <pre className="mt-1 whitespace-pre-wrap text-xs">{row.prompt}</pre>
                  </details>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">Verdict</h2>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setPublishError("");
                  setDropError("");
                  document.querySelector<HTMLTextAreaElement>("#studio-recipe-behaviour textarea")?.focus();
                }}>
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setPublishError("");
                    if (!dropReason.trim()) {
                      setDropError("Write a reason.");
                      return;
                    }
                    const res = await fetch("/api/platform/catalogue-studio/drop", {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ candidateId: candidate.data?.id, dropReason }),
                    });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      setDropError(body.error || "Drop stopped");
                      return;
                    }
                    setDropError("");
                    setPublishError("");
                    setVerdict("dropped");
                    const next = String(body.nextCandidateId || "");
                    setLocation(next ? `/admin/catalogue-studio?candidate=${encodeURIComponent(next)}` : "/admin/catalogue-studio");
                  }}
                >
                  Drop
                </Button>
                {candidate.data?.canDelete ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (!window.confirm("Delete this candidate? It has no artwork.")) return;
                      setPublishError("");
                      setDropError("");
                      const res = await fetch("/api/platform/catalogue-studio/delete", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ candidateId: candidate.data?.id }),
                      });
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setDropError(body.error || "Delete stopped");
                        return;
                      }
                      const next = String(body.nextCandidateId || "");
                      setLocation(next ? `/admin/catalogue-studio?candidate=${encodeURIComponent(next)}` : "/admin/catalogue-studio");
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
              <Textarea value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="Drop reason" />
              {dropError ? <p className="text-xs">{dropError}</p> : null}
              {verdict === "dropped" ? <p>Dropped: {dropReason}</p> : null}
              {job?.phase === "done" ? <p>Done</p> : null}
              {(candidate.data?.publishTypes || []).map((type) => (
                <div key={type.id} className="space-y-2" data-testid={`catalogue-publish-type-${type.id}`}>
                  {type.published ? (
                    <p className="text-sm">
                      {type.name}: Already published
                      {type.productUrl ? (
                        <>
                          {" "}
                          <a className="underline" href={type.productUrl} target="_blank" rel="noreferrer">Open</a>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <>
                      <label className="flex items-center text-sm">
                        <input
                          type="checkbox"
                          className="mr-2"
                          checked={Boolean(publishTicks[type.id])}
                          onChange={() => setPublishTicks((current) => ({ ...current, [type.id]: !current[type.id] }))}
                        />
                        Publish to {type.name}
                      </label>
                      {publishTicks[type.id] ? (
                        <ul className="ml-6 space-y-1">
                          {type.colors.map((color) => {
                            const resolved = resolvePublishPanelId(panelId, type.panelRows || []);
                            const requested = panelId || resolved;
                            const scene = publishColourScene(requested, resolved, color.photographs || []);
                            const blocked = !scene;
                            const on = !blocked && (publishColours[type.id] || []).includes(color.name);
                            return (
                              <li key={color.name}>
                                <label className={`flex items-center text-sm ${blocked ? "text-muted-foreground" : ""}`}>
                                  <input
                                    type="checkbox"
                                    className="mr-2"
                                    checked={on}
                                    disabled={blocked}
                                    onChange={() => {
                                      if (blocked) return;
                                      const list = publishColours[type.id] || [];
                                      const next = on ? list.filter((name) => name !== color.name) : [...list, color.name];
                                      setPublishColours((current) => ({ ...current, [type.id]: next }));
                                      setPublishNote("");
                                      const id = candidate.data?.id;
                                      if (id) savePublishSetup(id, { productTypeId: type.id, colorNames: next });
                                    }}
                                  />
                                  {color.hex ? (
                                    <span
                                      aria-hidden
                                      className="mr-2 inline-block h-3 w-3 rounded-full border border-border"
                                      style={{ backgroundColor: `#${color.hex}` }}
                                    />
                                  ) : null}
                                  <span>
                                    {color.name}
                                    {blocked || !scene
                                      ? " — No photograph uploaded. This colour cannot be published."
                                      : ` — ${scene.label}${scene.fallback ? " (fallback)" : ""}`}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {verdict !== "dropped" && (openPublishTypes.length > 0 || published.data?.designProductId) ? (
                <>
                  <label className="flex items-center text-sm" data-testid="catalogue-my-pet-enabled">
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={myPetEnabled}
                      onChange={(event) => void saveMyPet(event.target.checked)}
                    />
                    My Pet enabled
                  </label>
                  {publishNote ? <p className="text-xs text-muted-foreground" data-testid="catalogue-studio-publish-setup-note">{publishNote}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {published.data?.designProductId
                      ? "Saved on this listing. A type that is not published yet uses the same choice."
                      : "Written to every listing in this publish. You can change it later on the Shopify product."}
                  </p>
                </>
              ) : null}
              {openPublishTypes.length && verdict !== "dropped" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={publishBusy || jobActive || !openPublishTypes.some((type) => publishTicks[type.id])}
                  onClick={() => void publishCandidate()}
                >
                  {publishLabel}
                </Button>
              ) : null}
              {publishError || (job?.phase === "failed" && (job.error || job.label)) ? (
                <p className="whitespace-pre-wrap text-xs" data-testid="catalogue-studio-publish-error">
                  {[publishError, job?.phase === "failed" ? (job.error || job.label) : ""].filter(Boolean).join("\n")}
                </p>
              ) : null}
              {published.data?.designProductId ? (
                <div className="space-y-2 border-t pt-3">
                  <h2 className="font-medium">Edit colours</h2>
                  <EditColours apiBase={`/api/platform/catalogue-studio/design-products/${published.data.designProductId}`} />
                </div>
              ) : null}
            </section>

            <section className="space-y-1">
              <h2 className="font-medium">Costs</h2>
              <p data-testid="catalogue-studio-spend">{formatCatalogueSpend(spendUsd)} spent on this one so far</p>
              {spendLines.map((line) => (
                <p key={line.label} className="text-xs text-muted-foreground">
                  {line.label} {formatCatalogueSpend(line.usd)}{line.estimated ? " estimated" : ""}
                </p>
              ))}
            </section>
          </aside>
        ) : null}
      </div>
    </AdminLayout>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function MaskConfirm({
  maskPngBase64,
  photoDataUrl,
  onConfirm,
}: {
  maskPngBase64: string;
  photoDataUrl: string;
  onConfirm: (maskPngBase64: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const mask = new Image();
    mask.onload = () => {
      node.width = mask.width;
      node.height = mask.height;
      node.getContext("2d")?.drawImage(mask, 0, 0);
    };
    mask.src = `data:image/png;base64,${maskPngBase64}`;
  }, [maskPngBase64]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">The photograph is above the outline. White pixels are the garment. Paint to adjust, then store.</p>
      <img src={photoDataUrl} alt="" className="max-h-40 w-full object-contain" />
      <canvas
        ref={canvasRef}
        className="max-h-40 w-full bg-neutral-800 object-contain"
        onPointerDown={(event) => {
          const node = canvasRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const x = Math.floor(((event.clientX - rect.left) / rect.width) * node.width);
          const y = Math.floor(((event.clientY - rect.top) / rect.height) * node.height);
          const ctx = node.getContext("2d");
          if (!ctx) return;
          ctx.fillStyle = event.altKey ? "#000000" : "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
        }}
      />
      <Button
        type="button"
        size="sm"
        onClick={() => {
          const node = canvasRef.current;
          if (!node) return;
          void onConfirm(node.toDataURL("image/png"));
        }}
      >
        Store this mask
      </Button>
    </div>
  );
}
