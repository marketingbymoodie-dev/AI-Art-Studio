import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, parseApiErrorMessage } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Globe, LayoutTemplate, Loader2, Plus, ExternalLink, Trash2,
  ToggleLeft, ToggleRight, AlertTriangle, Wand2, Save, ArrowUpRight, TrendingUp,
  CheckCircle2, ChevronRight, DollarSign, Info, RefreshCw, Truck, Factory, Edit2, Upload,
} from "lucide-react";
import { SHOPIFY_MAX_VARIANTS_PER_PRODUCT } from "@shared/variantMapResolve";

/** Prefer all sizes, drop colours from the end until ≤ Shopify max (UI / prep helper). */
function trimSelectionToShopifyMax(
  sizeIds: string[],
  colorIds: string[],
): { sizeIds: string[]; colorIds: string[]; count: number; capped: boolean } {
  let sizes = sizeIds.filter(Boolean);
  let colors = colorIds.filter(Boolean);
  const countOf = () => sizes.length * (colors.length > 0 ? colors.length : 1);
  if (sizes.length === 0) {
    return { sizeIds: sizes, colorIds: colors, count: 0, capped: false };
  }
  if (countOf() <= SHOPIFY_MAX_VARIANTS_PER_PRODUCT) {
    return { sizeIds: sizes, colorIds: colors, count: countOf(), capped: false };
  }
  while (colors.length > 1 && countOf() > SHOPIFY_MAX_VARIANTS_PER_PRODUCT) {
    colors = colors.slice(0, -1);
  }
  while (sizes.length > 1 && countOf() > SHOPIFY_MAX_VARIANTS_PER_PRODUCT) {
    sizes = sizes.slice(0, -1);
  }
  return { sizeIds: sizes, colorIds: colors, count: countOf(), capped: true };
}
import { normalizeVariantLabelForCostMatch } from "@shared/printifyCostLabels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminLayout from "@/components/admin-layout";
import ResyncPricesDialog from "@/components/admin/ResyncPricesDialog";
import CatalogFilterBar from "@/components/admin/CatalogFilterBar";
import PlanPicker from "./plan-picker";
import GenerationQuotaUsage from "@/components/admin/GenerationQuotaUsage";
import CustomizerPageStyleSelector from "@/components/admin/CustomizerPageStyleSelector";
import { useSetupStatus } from "@/hooks/use-setup-status";
import {
  defaultStyleConfigForDesignerType,
  parseCustomizerPageStyleConfig,
  validateCustomizerPageStyleConfig,
  type CustomizerPageStyleConfig,
} from "@shared/customizerPageStyles";

interface CustomizerPage {
  id: string;
  shop: string;
  handle: string;
  title: string;
  baseVariantId: string;
  baseProductId: string | null;
  productTypeId: number | null;
  baseProductTitle: string | null;
  baseVariantTitle: string | null;
  baseProductPrice: string | null;
  status: "preview" | "active" | "disabled";
  styleConfig?: CustomizerPageStyleConfig | null;
  createdAt: string;
}

function statusBadgeLabel(status: CustomizerPage["status"]): string {
  if (status === "active") return "Live";
  if (status === "preview") return "Preview";
  return "Disabled";
}

interface PagesResponse {
  pages: CustomizerPage[];
  limit: number;
  count: number;
  planTier: string;
  planName: string | null;
  planStatus: string | null;
  requiresPlan: boolean;
  overLimit: boolean;
}

interface BlankVariant {
  id: string;
  title: string;
  price: string;
  sku?: string;
}

interface VariantOption {
  id: string;
  name: string;
  hex?: string;
}

interface WizardProvider {
  id: number;
  title: string;
  location?: { country?: string; city?: string; region?: string };
  fulfillment_countries?: string[];
  decoration_methods?: string[];
  pricingFromCents?: number | null;
  variantCount?: number | null;
  supportsBothSides?: boolean;
  rating?: number | null;
}

interface Blank {
  productTypeId: number;
  productId: string | null;
  title: string;
  imageUrl: string | null;
  needsShopifySync?: boolean;
  designerType?: string | null;
  isAllOverPrint?: boolean;
  printifyBlueprintId?: number | null;
  printifyProviderId?: number | null;
  /** Resolved from last OOS scan (oosDetail); null until first scan. */
  printifyProviderName?: string | null;
  printifyVariantLabels?: Record<string, string>;
  sizes?: VariantOption[];
  frameColors?: VariantOption[];
  selectedSizeIds?: string[];
  selectedColorIds?: string[];
  description?: string | null;
  /** Daily Printify stock scan (server/oos-catalogue-report.ts) — null until first scan runs. */
  oosStatus?: "ok" | "critical" | "fully_oos" | "error" | "unknown" | null;
  oosAvailableVariants?: number | null;
  oosTotalVariants?: number | null;
  lastOosScanAt?: string | null;
  baseMockupImages?: {
    primary?: string;
    front?: string;
    lifestyle?: string;
    gallery?: string[];
    custom?: string[];
    available?: Array<{ url: string; label: string; position?: string; source?: string }>;
  };
  variants: BlankVariant[];
}

function slugify(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Drop " — Printify Choice" / supplier suffixes from product or page titles (never show in H1). */
function stripProviderSuffix(name: string): string {
  return name.replace(/\s+[—–-]\s+.+$/u, "").trim();
}

function plainTextFromHtml(value: string | null | undefined): string {
  if (!value) return "";
  const withoutBreaks = value.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const withoutTags = withoutBreaks.replace(/<[^>]*>/g, " ");
  const doc = typeof document !== "undefined" ? document.createElement("textarea") : null;
  if (doc) {
    doc.innerHTML = withoutTags;
    return doc.value.replace(/\n\s+/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  return withoutTags.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

async function uploadPlaceholderFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const res = await fetch("/api/uploads/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, name: file.name }),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const data = await res.json();
  const objectPath = data.objectPath as string;
  return objectPath?.startsWith("/") ? `${window.location.origin}${objectPath}` : objectPath;
}

const MAX_GALLERY_PLACEHOLDERS = 4;

function buildCuratedPlaceholderPayload(
  primary: string,
  gallery: Set<string>,
  existingCustom: string[] | undefined,
  newCustomUrl: string,
): { primary: string; gallery: string[]; custom: string[] } {
  const galleryArr = Array.from(gallery);
  const selected = new Set([primary, ...galleryArr].filter(Boolean));
  const custom = [...(existingCustom || []), newCustomUrl.trim()]
    .filter(Boolean)
    .filter((url) => selected.has(url))
    .slice(0, MAX_GALLERY_PLACEHOLDERS);
  return { primary, gallery: galleryArr, custom };
}

type PlaceholderImageOption = { url: string; label: string; position?: string; source?: string };

function buildAvailablePlaceholderImages(
  images: Blank["baseMockupImages"] | undefined,
  customUrl?: string,
): PlaceholderImageOption[] {
  const imgs = images || {};
  return [
    imgs.primary ? { url: imgs.primary, label: "Current primary image", source: "current" } : null,
    imgs.front ? { url: imgs.front, label: "Front placeholder", position: "front", source: "stored" } : null,
    imgs.lifestyle ? { url: imgs.lifestyle, label: "Lifestyle placeholder", position: "lifestyle", source: "stored" } : null,
    ...(imgs.gallery || []).map((url, index) => ({ url, label: `Gallery image ${index + 1}`, source: "gallery" })),
    ...(imgs.available || []),
    ...(imgs.custom || []).map((url) => ({ url, label: "Custom image", source: "custom" })),
    customUrl ? { url: customUrl, label: "Uploaded custom image", source: "custom" } : null,
  ]
    .filter((img): img is PlaceholderImageOption => !!img?.url)
    .filter((img, index, arr) => arr.findIndex((x) => x.url === img.url) === index);
}

const PLAN_DISPLAY: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  dabbler: "Dabbler",
  pro: "Pro",
  pro_plus: "Pro Plus",
};

const STYLE_CATEGORY_LABELS: Record<string, string> = {
  decor: "All Decor styles",
  apparel: "All Apparel styles",
  graphics: "All Graphics styles",
  all: "All styles",
};

function formatStyleConfigSummary(
  config: CustomizerPageStyleConfig | null | undefined,
  styles: Array<{ id: number | string; name: string }>,
): string {
  if (!config) return "No styles configured";
  if (config.mode === "category") {
    return STYLE_CATEGORY_LABELS[config.category] ?? config.category;
  }
  const names = config.presetIds
    .map((id) => styles.find((s) => String(s.id) === id)?.name ?? null)
    .filter(Boolean) as string[];
  if (names.length === 0) return `${config.presetIds.length} selected style(s)`;
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

export default function AdminCustomizerPages() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: setupStatus } = useSetupStatus();
  const printifyConnected = !!setupStatus?.printifyConnected;

  const [createOpen, setCreateOpen] = useState(false);
  // Deep-link from Products page ("Create Customizer Page" button):
  // ?createForProductType={productTypeId} opens the wizard pre-selecting that product.
  const [pendingCreateProductTypeId, setPendingCreateProductTypeId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("createForProductType");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  });
  // Catalogue "Create Page" / "Add to store" deep-links.
  const [pendingCreateBlueprintId, setPendingCreateBlueprintId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("createFromBlueprint");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [listSearch, setListSearch] = useState("");
  const [listCategory, setListCategory] = useState("all");
  const [listStatus, setListStatus] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<CustomizerPage | null>(null);
  const [syncPricesTarget, setSyncPricesTarget] = useState<CustomizerPage | null>(null);
  const [editTarget, setEditTarget] = useState<CustomizerPage | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editPricingStrategy, setEditPricingStrategy] = useState("notify_only");
  const [editMarkupPercent, setEditMarkupPercent] = useState("60");
  const [editMinMarginPercent, setEditMinMarginPercent] = useState("");
  const [editPrimaryPlaceholder, setEditPrimaryPlaceholder] = useState("");
  const [editGalleryPlaceholders, setEditGalleryPlaceholders] = useState<Set<string>>(new Set());
  const [editCustomPlaceholder, setEditCustomPlaceholder] = useState("");
  const [uploadingPlaceholder, setUploadingPlaceholder] = useState(false);
  const placeholderUploadRef = useRef<HTMLInputElement>(null);
  const placeholderHealAttemptedRef = useRef<number | null>(null);

  // Hub URL (fallback for disabled pages)
  const [hubUrl, setHubUrl] = useState("");

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formHandle, setFormHandle] = useState("");
  const [formProductId, setFormProductId] = useState("");
  const [formPrimaryPlaceholder, setFormPrimaryPlaceholder] = useState("");
  const [formGalleryPlaceholders, setFormGalleryPlaceholders] = useState<Set<string>>(new Set());
  const [formCustomPlaceholder, setFormCustomPlaceholder] = useState("");
  const [formStyleConfig, setFormStyleConfig] = useState<CustomizerPageStyleConfig | null>(null);
  const [editStyleConfig, setEditStyleConfig] = useState<CustomizerPageStyleConfig | null>(null);
  const [handleTouched, setHandleTouched] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);

  // Wizard state — Page info → Supplier → Variants → Pricing → Confirm → Success
  const [formStep, setFormStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  /** Step 2 (print provider) selection. Defaults to the product's current Printify supplier. */
  const [wizardProviderId, setWizardProviderId] = useState<number | null>(null);
  const [wizardSizes, setWizardSizes] = useState<VariantOption[]>([]);
  const [wizardColors, setWizardColors] = useState<VariantOption[]>([]);
  const [wizardSizeIds, setWizardSizeIds] = useState<Set<string>>(new Set());
  const [wizardColorIds, setWizardColorIds] = useState<Set<string>>(new Set());
  const [wizardVariantsLoading, setWizardVariantsLoading] = useState(false);
  const [wizardVariantsReady, setWizardVariantsReady] = useState(false);
  /** Tracks blueprint:provider already prepared so costs can prefetch during Variants. */
  const preparedProviderKeyRef = useRef<string | null>(null);
  const [variantPrices, setVariantPrices] = useState<Record<string, string>>({});
  /** Front+back retail prices — only used when Printify costs include a both-sides tier. */
  const [variantPricesBoth, setVariantPricesBoth] = useState<Record<string, string>>({});
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [confirmedVariants, setConfirmedVariants] = useState<BlankVariant[]>([]);
  const [createdPageResult, setCreatedPageResult] = useState<any>(null);
  const [placeholderStepAlert, setPlaceholderStepAlert] = useState<string | null>(null);

  // Edit-modal variant picker
  const [editSizes, setEditSizes] = useState<VariantOption[]>([]);
  const [editColors, setEditColors] = useState<VariantOption[]>([]);
  const [editSizeIds, setEditSizeIds] = useState<Set<string>>(new Set());
  const [editColorIds, setEditColorIds] = useState<Set<string>>(new Set());
  const [editVariantsLoading, setEditVariantsLoading] = useState(false);

  // Costs popup state
  const [costsOpen, setCostsOpen] = useState(false);
  const [costsActiveTab, setCostsActiveTab] = useState<"production" | "shipping">("production");
  const [costsShippingCountry, setCostsShippingCountry] = useState("US");
  const [costsShippingTier, setCostsShippingTier] = useState("standard");

  // Markup percentage for recommended retail pricing (default 60%)
  const [markupPercent, setMarkupPercent] = useState(60);

  const { data: pagesData, isLoading: pagesLoading, error: pagesError } = useQuery<PagesResponse>({
    queryKey: ["/api/appai/customizer-pages"],
  });

  // Parse REAUTH_REQUIRED from query errors so we can show a reconnect banner
  const reauthData = (() => {
    if (!pagesError) return null;
    try {
      // throwIfResNotOk formats the error as: "401: <json body>"
      const raw = (pagesError as Error).message ?? "";
      const jsonStart = raw.indexOf("{");
      if (jsonStart === -1) return null;
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed?.error === "REAUTH_REQUIRED") return parsed as { error: string; reinstallUrl: string };
    } catch {
      // not a parseable JSON error — ignore
    }
    return null;
  })();

  // Initialise hub URL from server response
  const hubUrlFromServer = (pagesData as any)?.hubUrl;
  if (!hubUrl && hubUrlFromServer) setHubUrl(hubUrlFromServer);

  const hubUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("PATCH", "/api/appai/shop-settings", {
        customizerHubUrl: url,
      });
      return res.json();
    },
    onSuccess: () => toast({ title: "Saved", description: "Fallback URL updated." }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: blanksData, isLoading: blanksLoading } = useQuery<{ blanks: Blank[] }>({
    queryKey: ["/api/appai/blanks"],
    // Always on (not just create/edit) — the pages list badge below needs oosStatus per row.
  });

  // Platform catalogue — so Create Page can list every ready-to-go product, not only imports.
  const { data: setupCatalogData } = useQuery<{
    entries: Array<{ blueprintId: number; label: string; existingProductType?: { id: number } | null }>;
  }>({
    queryKey: ["/api/appai/setup/catalog"],
    enabled: createOpen || pendingCreateBlueprintId != null,
  });

  /** Import a catalogue blueprint as a product_type (Preview not required). */
  const ensureCatalogProductMutation = useMutation({
    mutationFn: async (blueprintId: number) => {
      const res = await apiRequest("POST", "/api/appai/setup/activate-product", { blueprintId });
      return res.json() as Promise<{ productTypeId: number }>;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/appai/setup/catalog"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      await queryClient.refetchQueries({ queryKey: ["/api/appai/blanks"] });
      const blanks = queryClient.getQueryData<{ blanks: Blank[] }>(["/api/appai/blanks"])?.blanks ?? [];
      const match = blanks.find((b) => b.productTypeId === data.productTypeId);
      setFormProductId(match?.productId ? match.productId : `pt:${data.productTypeId}`);
      setCreateOpen(true);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't prepare product",
        description: parseApiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  // Open the create wizard as soon as we know a deep-linked product is pending.
  useEffect(() => {
    if (pendingCreateProductTypeId != null || pendingCreateBlueprintId != null) setCreateOpen(true);
  }, [pendingCreateProductTypeId, pendingCreateBlueprintId]);

  // Once blanks have loaded, pre-select the deep-linked product and clear the query param.
  useEffect(() => {
    if (pendingCreateProductTypeId == null) return;
    if (!blanksData?.blanks) return;
    const match = blanksData.blanks.find((b) => b.productTypeId === pendingCreateProductTypeId);
    if (match) {
      setFormProductId(match.productId ? match.productId : `pt:${match.productTypeId}`);
    } else if (!ensureCatalogProductMutation.isPending) {
      // Product type exists but blanks not ready yet — still select by pt id.
      setFormProductId(`pt:${pendingCreateProductTypeId}`);
    }
    setPendingCreateProductTypeId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("createForProductType");
    window.history.replaceState({}, "", url.toString());
  }, [pendingCreateProductTypeId, blanksData]);

  // Catalogue Create Page: pre-select by blueprint, or prepare product_type on demand.
  useEffect(() => {
    if (pendingCreateBlueprintId == null) return;
    if (blanksData === undefined) return;
    const bpId = pendingCreateBlueprintId;
    const match = blanksData.blanks.find((b) => b.printifyBlueprintId === bpId);
    setPendingCreateBlueprintId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("createFromBlueprint");
    window.history.replaceState({}, "", url.toString());
    if (match) {
      setFormProductId(match.productId ? match.productId : `pt:${match.productTypeId}`);
      setCreateOpen(true);
      return;
    }
    setCreateOpen(true);
    ensureCatalogProductMutation.mutate(bpId);
  }, [pendingCreateBlueprintId, blanksData]);

  const { data: adminStyles = [] } = useQuery<Array<{ id: number; name: string; category?: string | null }>>({
    queryKey: ["/api/admin/styles"],
  });

  const editBlank = useMemo(() => {
    if (!editTarget || !blanksData?.blanks) return null;
    return blanksData.blanks.find(
      (b) => b.productTypeId === editTarget.productTypeId ||
             b.productId === editTarget.baseProductId
    ) ?? null;
  }, [editTarget, blanksData]);

  useEffect(() => {
    if (!editTarget || !editBlank) return;
    const images = editBlank.baseMockupImages || {};
    setEditDescription(plainTextFromHtml(editBlank.description));
    setEditPricingStrategy((editBlank as any).pricingStrategy || "notify_only");
    setEditMarkupPercent(String((editBlank as any).defaultMarkupPercent ?? 60));
    setEditMinMarginPercent(
      (editBlank as any).minMarginPercent != null ? String((editBlank as any).minMarginPercent) : "",
    );
    setEditPrimaryPlaceholder(images.primary || images.front || images.gallery?.[0] || "");
    setEditGalleryPlaceholders(new Set((images.gallery || []).filter(Boolean).slice(0, MAX_GALLERY_PLACEHOLDERS)));
    setEditCustomPlaceholder("");
  }, [editTarget?.id, editBlank?.productTypeId, editBlank?.description]);

  // Backfill Printify catalog copy when Create Page left description empty.
  useEffect(() => {
    if (!editTarget || !editBlank?.productTypeId) return;
    if (String(editBlank.description || "").trim()) return;
    if (!editBlank.printifyBlueprintId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest(
          "POST",
          `/api/admin/product-types/${editBlank.productTypeId}/refresh-description`,
        );
        const data = await res.json();
        if (cancelled || !data?.description) return;
        setEditDescription(plainTextFromHtml(data.description));
        queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      } catch {
        /* Printify may have no description — leave empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editTarget?.id, editBlank?.productTypeId, editBlank?.description, editBlank?.printifyBlueprintId]);

  useEffect(() => {
    if (!editTarget) {
      setEditStyleConfig(null);
      return;
    }
    setEditStyleConfig(
      parseCustomizerPageStyleConfig(editTarget.styleConfig) ??
        defaultStyleConfigForDesignerType(editBlank?.designerType),
    );
  }, [editTarget?.id, editTarget?.styleConfig, editBlank?.designerType]);

  const shopDomain =
    createdPageResult?.page?.shop ??
    pagesData?.pages?.find((p) => p.shop)?.shop ??
    pagesData?.pages?.[0]?.shop ??
    "";

  const createMutation = useMutation({
    mutationFn: async (body: {
      title: string;
      handle: string;
      baseProductId?: string;
      productTypeId?: number;
      variantPrices: Record<string, string>;
      variantPricesBoth?: Record<string, string>;
      baseMockupImages?: { primary: string; gallery: string[]; custom?: string[] };
      styleConfig: CustomizerPageStyleConfig;
    }) => {
      const res = await apiRequest("POST", "/api/appai/customizer-pages", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
      setCreatedPageResult(data);
      setFormStep(6);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/appai/customizer-pages/${id}`, { status });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const scanStockMutation = useMutation({
    mutationFn: async (productTypeId: number) => {
      const res = await apiRequest("POST", `/api/admin/product-types/${productTypeId}/scan-stock`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      const result = data?.result;
      const status = result?.status;
      const via = result?.providerName
        ? ` (${result.providerName})`
        : result?.providerId != null
          ? ` (provider #${result.providerId})`
          : "";
      toast({
        title:
          status === "fully_oos"
            ? `Fully out of stock${via}`
            : status === "critical"
              ? `Critically low stock${via}`
              : status === "error"
                ? `Stock scan failed${via}`
                : `Stock is OK${via}`,
        description:
          status === "error"
            ? (result?.error ?? "Could not reach Printify.")
            : `${result?.availableSelected ?? 0} of ${result?.totalSelected ?? 0} variants in stock for this product's Printify supplier.`,
        variant: status === "fully_oos" || status === "critical" || status === "error" ? "destructive" : undefined,
      });
    },
    onError: (err: any) => toast({ title: "Stock scan failed", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!editTarget) throw new Error("No customizer page selected");
      const styleErr = validateCustomizerPageStyleConfig(editStyleConfig);
      if (styleErr) throw new Error(styleErr);
      const curated = buildCuratedPlaceholderPayload(
        editPrimaryPlaceholder,
        editGalleryPlaceholders,
        editBlank?.baseMockupImages?.custom,
        editCustomPlaceholder,
      );
      const res = await apiRequest("PATCH", `/api/appai/customizer-pages/${editTarget.id}`, {
        description: editDescription,
        styleConfig: editStyleConfig,
        baseMockupImages: curated,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update customizer page");
      }
      if (editBlank?.productTypeId) {
        const markup = parseInt(editMarkupPercent, 10);
        const minM = editMinMarginPercent.trim() ? parseInt(editMinMarginPercent, 10) : null;
        const ptRes = await apiRequest("PATCH", `/api/admin/product-types/${editBlank.productTypeId}`, {
          pricingStrategy: editPricingStrategy,
          defaultMarkupPercent: Number.isFinite(markup) ? markup : null,
          minMarginPercent: minM != null && Number.isFinite(minM) ? minM : null,
        });
        if (!ptRes.ok) {
          const body = await ptRes.json().catch(() => ({}));
          throw new Error(body.error || "Page saved but pricing strategy failed");
        }
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      setEditTarget(null);
      setEditCustomPlaceholder("");
      toast({ title: "Customizer updated", description: "Description and placeholder settings were saved." });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!id) throw new Error("Missing page ID");
      const res = await apiRequest("DELETE", `/api/appai/customizer-pages/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/customizer-pages"] });
      setDeleteTarget(null);
      toast({ title: "Page deleted", description: "The customizer page has been removed." });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Unknown error";
      console.error("[delete customizer-page]", msg);
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    },
  });

  function toggleEditGalleryPlaceholder(url: string) {
    setEditGalleryPlaceholders((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else if (next.size < MAX_GALLERY_PLACEHOLDERS) {
        next.add(url);
      }
      return next;
    });
  }

  function toggleFormGalleryPlaceholder(url: string) {
    setFormGalleryPlaceholders((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else if (next.size < MAX_GALLERY_PLACEHOLDERS) {
        next.add(url);
      }
      return next;
    });
  }

  async function handlePlaceholderUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type)) {
      toast({ title: "Unsupported image", description: "Upload a PNG, JPG, or WebP image.", variant: "destructive" });
      event.target.value = "";
      return;
    }
    setUploadingPlaceholder(true);
    try {
      const url = await uploadPlaceholderFile(file);
      setEditCustomPlaceholder(url);
      setEditPrimaryPlaceholder(url);
      setEditGalleryPlaceholders((prev) => new Set([...Array.from(prev), url].slice(0, MAX_GALLERY_PLACEHOLDERS)));
      toast({ title: "Placeholder uploaded", description: "The uploaded image is selected as the primary placeholder." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Could not upload placeholder image.", variant: "destructive" });
    } finally {
      setUploadingPlaceholder(false);
      event.target.value = "";
    }
  }

  async function handleFormPlaceholderUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type)) {
      toast({ title: "Unsupported image", description: "Upload a PNG, JPG, or WebP image.", variant: "destructive" });
      event.target.value = "";
      return;
    }
    setUploadingPlaceholder(true);
    try {
      const url = await uploadPlaceholderFile(file);
      setFormCustomPlaceholder(url);
      setFormPrimaryPlaceholder(url);
      setFormGalleryPlaceholders((prev) => new Set([...Array.from(prev), url].slice(0, MAX_GALLERY_PLACEHOLDERS)));
      toast({ title: "Placeholder uploaded", description: "The uploaded image is selected as the primary placeholder." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Could not upload placeholder image.", variant: "destructive" });
    } finally {
      setUploadingPlaceholder(false);
      event.target.value = "";
    }
  }

  function resetForm() {
    setFormTitle("");
    setFormHandle("");
    setFormProductId("");
    setFormPrimaryPlaceholder("");
    setFormGalleryPlaceholders(new Set());
    setFormCustomPlaceholder("");
    setFormStyleConfig(null);
    setHandleTouched(false);
    setTitleTouched(false);
    setFormStep(1);
    setWizardProviderId(null);
    setWizardSizes([]);
    setWizardColors([]);
    setWizardSizeIds(new Set());
    setWizardColorIds(new Set());
    setWizardVariantsReady(false);
    setVariantPrices({});
    setVariantPricesBoth({});
    setPriceErrors({});
    setCreatedPageResult(null);
    setPlaceholderStepAlert(null);
  }

  function handleTitleChange(val: string) {
    setTitleTouched(true);
    setFormTitle(val);
    if (!handleTouched) setFormHandle(slugify(val));
  }

  /** Simplify a Printify product name to a short page title.
   *  e.g. "Custom Spun Polyester Square Pillow" → "Square Pillow"
   *       "Premium Unisex Crewneck Sweatshirt" → "Crewneck Sweatshirt"
   *  Always strips supplier suffixes like " — Printify Choice".
   */
  function simplifyProductName(name: string): string {
    const STRIP_WORDS = [
      "custom", "spun", "polyester", "premium", "unisex", "classic",
      "basic", "standard", "all-over", "all over", "print",
      "sublimation", "sublimated", "dye", "digital",
    ];
    let words = stripProviderSuffix(name).split(/\s+/);
    // Remove leading words that match the strip list
    while (words.length > 1 && STRIP_WORDS.includes(words[0].toLowerCase().replace(/[^a-z]/g, ""))) {
      words = words.slice(1);
    }
    return words.join(" ");
  }

  /** Derive variants for the currently-selected product (Step 2 pricing) */
  const selectedBlank = (blanksData?.blanks ?? []).find((b) => {
    const canonical = b.productId ? b.productId : `pt:${b.productTypeId}`;
    return canonical === formProductId || formProductId === `pt:${b.productTypeId}`;
  });

  /**
   * Deduplicate variants by full label — keeps all distinct variants including
   * products with meaningful material/color variants (e.g. Body Pillow: Polyester
   * vs Microfiber). Phone cases with cosmetic color variants will show multiple rows
   * but the auto-calculator fills them with the same price.
   */
  const selectedVariants: BlankVariant[] = useMemo(() => {
    const raw = selectedBlank?.variants ?? [];
    const seen = new Set<string>();
    const deduped: BlankVariant[] = [];
    for (const v of raw) {
      if (!seen.has(v.title)) {
        seen.add(v.title);
        deduped.push(v);
      }
    }
    return deduped;
  }, [selectedBlank?.variants]);

  // Printify costs query -- fetches production costs via temporary product probe
  const {
    data: costsData,
    isLoading: costsLoading,
    isError: costsError,
    error: costsFetchError,
    refetch: refetchCosts,
  } = useQuery<{
    costs: Record<string, number>;
    costsBoth?: Record<string, number>;
    shopifyVariantCosts: Record<string, number>;
    shopifyVariantCostsBoth?: Record<string, number>;
    printifyVariantLabels: Record<string, string>;
    costsByNormalizedLabel?: Record<string, number>;
    costsBothByNormalizedLabel?: Record<string, number>;
    supportsBothSides?: boolean;
    cached: boolean;
    warning?: string;
  }>({
    queryKey: ["/api/admin/printify/costs", selectedBlank?.productTypeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/printify/costs/${selectedBlank!.productTypeId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || "Failed to fetch production costs from Printify");
      }
      return res.json();
    },
    // Prefetch during Variants (step 3) once the product type is on the chosen supplier.
    enabled:
      (costsOpen || formStep >= 3) &&
      !!selectedBlank?.productTypeId &&
      (wizardProviderId == null || selectedBlank.printifyProviderId === wizardProviderId),
    retry: false,
  });

  const costsErrorPayload = useMemo(() => {
    if (!costsFetchError) return null;
    const text = costsFetchError instanceof Error ? costsFetchError.message : String(costsFetchError);
    const jsonStart = text.indexOf("{");
    if (jsonStart === -1) return null;
    try {
      return JSON.parse(text.slice(jsonStart)) as {
        code?: string;
        error?: string;
        message?: string;
        oosStatus?: string;
        providerName?: string | null;
      };
    } catch {
      return null;
    }
  }, [costsFetchError]);

  const selectedBlankFullyOos =
    selectedBlank?.oosStatus === "fully_oos" || costsErrorPayload?.code === "PRINTIFY_FULLY_OOS";
  const selectedBlankProviderLabel =
    costsErrorPayload?.providerName ||
    selectedBlank?.printifyProviderName ||
    (selectedBlank?.printifyProviderId != null ? `Provider #${selectedBlank.printifyProviderId}` : null);

  useEffect(() => {
    if (formStep !== 4 || !costsError || !costsFetchError) return;
    if (costsErrorPayload?.code === "PRINTIFY_FULLY_OOS") {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      toast({
        title: "Printify stock unavailable",
        description: parseApiErrorMessage(costsFetchError),
        variant: "destructive",
      });
      return;
    }
    const msg = parseApiErrorMessage(
      costsFetchError instanceof Error ? costsFetchError.message : costsFetchError,
    );
    toast({
      title: "Production costs unavailable",
      description: msg,
      variant: "destructive",
    });
  }, [formStep, costsError, costsFetchError, costsErrorPayload?.code, toast, queryClient]);

  // Product Sync: refresh Product Intelligence (COGS / availability), then reload cost UI from DB.
  const productSyncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBlank?.productTypeId) throw new Error("No product selected");
      const res = await apiRequest(
        "POST",
        `/api/admin/product-types/${selectedBlank.productTypeId}/product-sync`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Product Sync failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/printify/costs"] });
      queryClient.removeQueries({ queryKey: ["/api/admin/printify/costs", selectedBlank?.productTypeId] });
      const r = data?.result;
      toast({
        title: r?.ok === false ? "Product Sync finished with issues" : "Product Sync complete",
        description: r?.error
          ? r.error
          : "COGS and availability updated. Reloading pricing…",
        variant: r?.ok === false ? "destructive" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Product Sync failed",
        description: error.message || "Could not sync product intelligence.",
        variant: "destructive",
      });
    },
  });

  const refreshPlaceholderImagesMutation = useMutation({
    mutationFn: async (productTypeId: number) => {
      const res = await apiRequest("POST", `/api/admin/product-types/${productTypeId}/refresh-images`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load catalog images");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
    },
  });

  // Refresh costs → Product Sync (sole preferred path). Legacy clear-cache removed from UI.

  // Shipping rates query
  const { data: shippingData, isLoading: shippingLoading } = useQuery<{
    shipping: Record<string, any[]>;
    tiers: string[];
    countries: string[];
  }>({
    queryKey: ["/api/admin/printify/shipping", selectedBlank?.printifyBlueprintId, selectedBlank?.printifyProviderId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/printify/shipping/${selectedBlank!.printifyBlueprintId}/${selectedBlank!.printifyProviderId}`);
      return res.json();
    },
    enabled: costsOpen && !!selectedBlank?.printifyBlueprintId && !!selectedBlank?.printifyProviderId,
  });

  // Helper to round up to .95
  function roundUpTo95(num: number): number {
    return Math.ceil(num) - 0.05;
  }

  /** Blank variant ids from /api/appai/blanks use `printify:{id}`; costs keys are raw Printify ids. */
  function resolveBlankVariantCostCents(
    v: BlankVariant,
    costs: {
      costs?: Record<string, number>;
      shopifyVariantCosts?: Record<string, number>;
      printifyVariantLabels?: Record<string, string>;
      costsByNormalizedLabel?: Record<string, number>;
    },
    labelToCost: Record<string, number>,
  ): number | undefined {
    let costCents: number | undefined = costs.shopifyVariantCosts?.[v.id];
    if (costCents == null && v.id.startsWith("printify:")) {
      costCents = costs.costs?.[v.id.slice("printify:".length)];
    }
    if (costCents == null) costCents = costs.costs?.[v.id];
    if (costCents == null && v.title && costs.costsByNormalizedLabel) {
      costCents = costs.costsByNormalizedLabel[normalizeVariantLabelForCostMatch(v.title)];
    }
    if (costCents == null && v.title) {
      const normTitle = normalizeVariantLabelForCostMatch(v.title);
      costCents = labelToCost[normTitle];
      if (costCents == null) {
        for (const [label, cost] of Object.entries(labelToCost)) {
          if (normTitle.includes(label) || label.includes(normTitle)) {
            costCents = cost;
            break;
          }
        }
      }
    }
    return costCents;
  }

  const costsAvailable =
    !!costsData?.costs && Object.keys(costsData.costs).length > 0;

  const supportsBothSidePricing = !!(
    costsData?.supportsBothSides &&
    costsData?.costsBoth &&
    Object.keys(costsData.costsBoth).length > 0
  );

  // Recommended retail prices based on production costs + markup
  const recommendedPrices = useMemo(() => {
    if (!costsAvailable || selectedVariants.length === 0) return {};
    const result: Record<string, string> = {};
    // Build a normalised-label → cost-in-cents lookup from Printify variant labels
    // e.g. { "14x14" → 850, "18x18" → 950, ... }
    const labelToCost: Record<string, number> = {};
    if (costsData.printifyVariantLabels && costsData.costs) {
      for (const [printifyVid, label] of Object.entries(costsData.printifyVariantLabels)) {
        const costCents = costsData.costs[printifyVid];
        if (costCents != null) {
          labelToCost[normalizeVariantLabelForCostMatch(label)] = costCents;
        }
      }
    }
    for (const v of selectedVariants) {
      const costCents = resolveBlankVariantCostCents(v, costsData, labelToCost);
      if (costCents == null) continue;
      const raw = (costCents / 100) * (1 + markupPercent / 100);
      result[v.id] = roundUpTo95(raw).toFixed(2);
    }
    return result;
  }, [costsAvailable, costsData, selectedVariants, markupPercent]);

  const recommendedPricesBoth = useMemo(() => {
    if (!supportsBothSidePricing || selectedVariants.length === 0) return {};
    const result: Record<string, string> = {};
    const labelToCost: Record<string, number> = {};
    if (costsData.printifyVariantLabels && costsData.costsBoth) {
      for (const [printifyVid, label] of Object.entries(costsData.printifyVariantLabels)) {
        const costCents = costsData.costsBoth[printifyVid];
        if (costCents != null) {
          labelToCost[normalizeVariantLabelForCostMatch(label)] = costCents;
        }
      }
    }
    const bothCostsData = { ...costsData, costs: costsData.costsBoth || {} };
    for (const v of selectedVariants) {
      const costCents = resolveBlankVariantCostCents(v, bothCostsData, labelToCost);
      if (costCents == null) continue;
      const raw = (costCents / 100) * (1 + markupPercent / 100);
      result[v.id] = roundUpTo95(raw).toFixed(2);
    }
    return result;
  }, [supportsBothSidePricing, costsData, selectedVariants, markupPercent]);

  // Auto-apply recommended prices to empty price fields whenever costs load or markup changes
  useEffect(() => {
    if (formStep !== 4) return;
    if (Object.keys(recommendedPrices).length === 0) return;
    setVariantPrices((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, price] of Object.entries(recommendedPrices)) {
        // Only fill in if the field is currently empty or zero
        if (!next[id] || next[id] === "" || next[id] === "0" || next[id] === "0.00") {
          next[id] = price;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [recommendedPrices, formStep]);

  useEffect(() => {
    if (formStep !== 4 || !supportsBothSidePricing) return;
    if (Object.keys(recommendedPricesBoth).length === 0) return;
    setVariantPricesBoth((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, price] of Object.entries(recommendedPricesBoth)) {
        if (!next[id] || next[id] === "" || next[id] === "0" || next[id] === "0.00") {
          next[id] = price;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [recommendedPricesBoth, formStep, supportsBothSidePricing]);

  // Prefill edit-modal variant checkboxes when opening a page
  useEffect(() => {
    if (!editTarget || !editBlank?.printifyBlueprintId || !editBlank.printifyProviderId) {
      setEditSizes([]);
      setEditColors([]);
      setEditSizeIds(new Set());
      setEditColorIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setEditVariantsLoading(true);
      try {
        const res = await fetch(
          `/api/admin/printify/blueprints/${editBlank.printifyBlueprintId}/variants?providerId=${editBlank.printifyProviderId}`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Failed to load variants");
        const data = await res.json();
        if (cancelled) return;
        const sizes: VariantOption[] = data.sizes || [];
        const colors: VariantOption[] = data.colors || [];
        setEditSizes(sizes);
        setEditColors(colors);
        const savedSizes = editBlank.selectedSizeIds ?? [];
        const savedColors = editBlank.selectedColorIds ?? [];
        let nextSizes = (savedSizes.length ? savedSizes : sizes.map((s) => s.id)).filter((id) =>
          sizes.some((s) => s.id === id),
        );
        let nextColors = (savedColors.length ? savedColors : colors.map((c) => c.id)).filter((id) =>
          colors.some((c) => c.id === id),
        );
        // Never open the editor with an illegal over-limit selection (legacy or "select all").
        const trimmed = trimSelectionToShopifyMax(nextSizes, nextColors);
        if (trimmed.capped) {
          nextSizes = trimmed.sizeIds;
          nextColors = trimmed.colorIds;
        }
        setEditSizeIds(new Set(nextSizes));
        setEditColorIds(new Set(nextColors));
      } catch {
        if (!cancelled) {
          setEditSizes(editBlank.sizes ?? []);
          setEditColors(editBlank.frameColors ?? []);
          setEditSizeIds(new Set(editBlank.selectedSizeIds ?? []));
          setEditColorIds(new Set(editBlank.selectedColorIds ?? []));
        }
      } finally {
        if (!cancelled) setEditVariantsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editTarget?.id, editBlank?.productTypeId, editBlank?.printifyProviderId]);

  // Auto-populate page title from product name when product is selected (if title not manually edited)
  useEffect(() => {
    if (!selectedBlank) return;
    if (titleTouched) return; // user has manually typed a title — don't overwrite
    const simplified = simplifyProductName(selectedBlank.title);
    setFormTitle(simplified);
    if (!handleTouched) setFormHandle(slugify(simplified));
  }, [selectedBlank?.title, titleTouched]);

  useEffect(() => {
    if (!selectedBlank) return;
    const images = selectedBlank.baseMockupImages || {};
    setFormPrimaryPlaceholder(images.primary || images.front || images.gallery?.[0] || "");
    setFormGalleryPlaceholders(new Set((images.gallery || []).filter(Boolean).slice(0, MAX_GALLERY_PLACEHOLDERS)));
    setFormCustomPlaceholder("");
  }, [selectedBlank?.productTypeId, formProductId]);

  useEffect(() => {
    if (!selectedBlank?.productTypeId) return;
    const available = buildAvailablePlaceholderImages(selectedBlank.baseMockupImages);
    if (available.length > 0) return;
    if (placeholderHealAttemptedRef.current === selectedBlank.productTypeId) return;
    if (refreshPlaceholderImagesMutation.isPending) return;
    placeholderHealAttemptedRef.current = selectedBlank.productTypeId;
    refreshPlaceholderImagesMutation.mutate(selectedBlank.productTypeId);
  }, [selectedBlank?.productTypeId, selectedBlank?.baseMockupImages]);

  useEffect(() => {
    if (!selectedBlank) {
      setFormStyleConfig(null);
      return;
    }
    setFormStyleConfig(defaultStyleConfigForDesignerType(selectedBlank.designerType));
  }, [selectedBlank?.productTypeId, formProductId]);

  // Default the Step 2 (print provider) picker to whatever supplier this product currently uses.
  useEffect(() => {
    setWizardProviderId(selectedBlank?.printifyProviderId ?? null);
  }, [selectedBlank?.productTypeId, formProductId]);

  // Print providers available for the selected product's Printify blueprint (Step 2).
  const { data: wizardProvidersData, isLoading: wizardProvidersLoading } = useQuery<WizardProvider[]>({
    queryKey: ["/api/admin/printify/blueprints", selectedBlank?.printifyBlueprintId, "providers"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/printify/blueprints/${selectedBlank!.printifyBlueprintId}/providers`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch print providers");
      return res.json();
    },
    enabled: formStep === 2 && !!selectedBlank?.printifyBlueprintId,
  });

  const wizardProviderLabel =
    wizardProvidersData?.find((p) => p.id === wizardProviderId)?.title ?? selectedBlankProviderLabel;

  const wizardVariantCount = useMemo(() => {
    const sizeCount = wizardSizeIds.size;
    if (sizeCount === 0) return 0;
    const colorCount = wizardColors.length === 0 ? 1 : wizardColorIds.size;
    if (wizardColors.length > 0 && colorCount === 0) return 0;
    return sizeCount * colorCount;
  }, [wizardSizeIds.size, wizardColorIds.size, wizardColors.length]);

  const wizardVariantCountValid =
    wizardVariantsReady &&
    wizardSizes.length > 0 &&
    wizardVariantCount > 0 &&
    wizardVariantCount <= SHOPIFY_MAX_VARIANTS_PER_PRODUCT;

  async function loadWizardVariants(blueprintId: number, providerId: number) {
    setWizardVariantsLoading(true);
    setWizardVariantsReady(false);
    setWizardSizes([]);
    setWizardColors([]);
    setWizardSizeIds(new Set());
    setWizardColorIds(new Set());
    try {
      const res = await fetch(
        `/api/admin/printify/blueprints/${blueprintId}/variants?providerId=${providerId}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch variants");
      const data = await res.json();
      const sizes: VariantOption[] = data.sizes || [];
      const colors: VariantOption[] = data.colors || [];
      if (sizes.length === 0) throw new Error("Printify returned no sizes for this supplier");
      setWizardSizes(sizes);
      setWizardColors(colors);
      // Prefer current product picks when staying on the same supplier
      const sameProvider = providerId === selectedBlank?.printifyProviderId;
      const savedSizes = selectedBlank?.selectedSizeIds ?? [];
      const savedColors = selectedBlank?.selectedColorIds ?? [];
      let nextSizes =
        sameProvider && savedSizes.length > 0
          ? savedSizes.filter((id) => sizes.some((s) => s.id === id))
          : sizes.map((s) => s.id);
      let nextColors =
        sameProvider && savedColors.length > 0 && colors.length > 0
          ? savedColors.filter((id) => colors.some((c) => c.id === id))
          : colors.map((c) => c.id);
      const trimmed = trimSelectionToShopifyMax(nextSizes, nextColors);
      setWizardSizeIds(new Set(trimmed.sizeIds));
      setWizardColorIds(new Set(trimmed.colorIds));
      setWizardVariantsReady(true);
    } catch (e: any) {
      setWizardVariantsReady(false);
      toast({
        title: "Failed to load variants",
        description: e?.message || "Retry before continuing.",
        variant: "destructive",
      });
    } finally {
      setWizardVariantsLoading(false);
    }
  }

  /**
   * Switch product type onto the chosen Printify supplier (clean title — no " — Provider" in H1).
   * Used for silent prep during Variants + final apply.
   */
  const ensureWizardProvider = useCallback(
    async (args: {
      sizeIds: string[];
      colorIds: string[];
      quiet?: boolean;
    }): Promise<{ productId: string; alreadyImported: boolean; existingProductName?: string }> => {
      if (!selectedBlank?.printifyBlueprintId || wizardProviderId == null) {
        throw new Error("Choose a print provider before continuing.");
      }
      const sameProvider = wizardProviderId === selectedBlank.printifyProviderId;
      const sizeIds = args.sizeIds;
      const colorIds = args.colorIds;

      if (sameProvider && selectedBlank.productTypeId) {
        const cleanName = stripProviderSuffix(selectedBlank.title);
        if (cleanName && cleanName !== selectedBlank.title) {
          try {
            await apiRequest("PATCH", `/api/admin/product-types/${selectedBlank.productTypeId}`, {
              name: cleanName,
            });
          } catch {
            // non-fatal — variants still save
          }
        }
        const res = await apiRequest("PATCH", `/api/admin/product-types/${selectedBlank.productTypeId}/variants`, {
          selectedSizeIds: sizeIds,
          selectedColorIds: colorIds,
        });
        await res.json();
        return {
          productId: selectedBlank.productId ? selectedBlank.productId : `pt:${selectedBlank.productTypeId}`,
          alreadyImported: false,
        };
      }

      // Never append supplier to the product name — that leaked into storefront H1s.
      const name = stripProviderSuffix(selectedBlank.title) || selectedBlank.title;
      try {
        const res = await apiRequest("POST", "/api/admin/printify/import", {
          blueprintId: selectedBlank.printifyBlueprintId,
          name,
          providerId: wizardProviderId,
          selectedSizeIds: sizeIds,
          selectedColorIds: colorIds,
        });
        const data = await res.json();
        return {
          productId: data?.shopifyProductId ? String(data.shopifyProductId) : `pt:${data?.id}`,
          alreadyImported: false,
        };
      } catch (err: any) {
        const text = err instanceof Error ? err.message : String(err);
        const jsonStart = text.indexOf("{");
        if (jsonStart !== -1) {
          try {
            const payload = JSON.parse(text.slice(jsonStart));
            if (payload?.code === "BLUEPRINT_ALREADY_IMPORTED" && payload.existingProductTypeId != null) {
              await apiRequest("PATCH", `/api/admin/product-types/${payload.existingProductTypeId}/variants`, {
                selectedSizeIds: sizeIds,
                selectedColorIds: colorIds,
              });
              // Rename away any legacy " — Provider" suffix on the product type.
              const cleanName = stripProviderSuffix(String(payload.existingProductName || name)) || name;
              if (payload.existingProductName && cleanName !== payload.existingProductName) {
                try {
                  await apiRequest("PATCH", `/api/admin/product-types/${payload.existingProductTypeId}`, {
                    name: cleanName,
                  });
                } catch {
                  // non-fatal
                }
              }
              return {
                productId: `pt:${payload.existingProductTypeId}`,
                alreadyImported: true,
                existingProductName: cleanName,
              };
            }
          } catch {
            // fall through
          }
        }
        throw err;
      }
    },
    [selectedBlank, wizardProviderId],
  );

  /** Silent supplier prep as soon as Variants loads — unlocks costs prefetch while merchant picks sizes. */
  const prepareProviderMutation = useMutation({
    mutationFn: async () => {
      if (!wizardSizes.length) throw new Error("Variants not loaded yet");
      // Explicit full pick can exceed Shopify’s 100 — trim before import (same as Setup auto-cap).
      const trimmed = trimSelectionToShopifyMax(
        wizardSizes.map((s) => s.id),
        wizardColors.map((c) => c.id),
      );
      return ensureWizardProvider({
        sizeIds: trimmed.sizeIds,
        colorIds: trimmed.colorIds,
        quiet: true,
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      await queryClient.refetchQueries({ queryKey: ["/api/appai/blanks"] });
      setFormProductId(result.productId);
      // Kick costs fetch (enabled once blanks show matching provider).
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/printify/costs"] });
    },
    onError: (err: Error) => {
      // Quiet — merchant can still finish Variants; final Next will retry.
      console.warn("[create-page] background provider prep failed:", err.message);
      preparedProviderKeyRef.current = null;
    },
  });

  // When Variants step is ready, prepare the chosen supplier in the background (costs start loading).
  useEffect(() => {
    if (formStep !== 3) return;
    if (!wizardVariantsReady || wizardProviderId == null || !selectedBlank?.printifyBlueprintId) return;
    const key = `${selectedBlank.printifyBlueprintId}:${wizardProviderId}`;
    if (selectedBlank.printifyProviderId === wizardProviderId) {
      preparedProviderKeyRef.current = key;
      return;
    }
    if (preparedProviderKeyRef.current === key || prepareProviderMutation.isPending) return;
    preparedProviderKeyRef.current = key;
    prepareProviderMutation.mutate();
  }, [
    formStep,
    wizardVariantsReady,
    wizardProviderId,
    selectedBlank?.printifyBlueprintId,
    selectedBlank?.printifyProviderId,
    prepareProviderMutation.isPending,
  ]);

  useEffect(() => {
    preparedProviderKeyRef.current = null;
  }, [wizardProviderId]);

  /** Apply final size/colour picks, then Pricing (costs often already warm from background prep). */
  const applySupplierAndVariantsMutation = useMutation({
    mutationFn: async () => {
      if (!wizardVariantCountValid) {
        throw new Error("Select sizes/colours within Shopify’s 100-variant limit.");
      }
      return ensureWizardProvider({
        sizeIds: Array.from(wizardSizeIds),
        colorIds: Array.from(wizardColorIds),
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      await queryClient.refetchQueries({ queryKey: ["/api/appai/blanks"] });
      setFormProductId(result.productId);
      if (result.alreadyImported) {
        toast({
          title: "Using existing product",
          description: `Already imported via that supplier as "${result.existingProductName ?? "another product"}".`,
        });
      }
      setVariantPrices({});
      setVariantPricesBoth({});
      setPriceErrors({});
      setFormStep(4);
    },
    onError: (err: any) => {
      toast({
        title: "Could not apply supplier / variants",
        description: parseApiErrorMessage(err),
        variant: "destructive",
      });
    },
  });

  const editVariantCount =
    editSizeIds.size * (editColors.length === 0 ? 1 : editColorIds.size);
  const editVariantOverLimit = editVariantCount > SHOPIFY_MAX_VARIANTS_PER_PRODUCT;

  const editVariantsMutation = useMutation({
    mutationFn: async () => {
      if (!editBlank?.productTypeId) throw new Error("No product linked");
      if (editSizeIds.size === 0 || (editColors.length > 0 && editColorIds.size === 0)) {
        throw new Error("Select at least one size and colour.");
      }
      if (editVariantOverLimit) {
        throw new Error(
          `Too many variants (${editVariantCount}). Shopify allows ${SHOPIFY_MAX_VARIANTS_PER_PRODUCT}. Deselect colours/sizes or use Auto-trim.`,
        );
      }
      const res = await apiRequest("PATCH", `/api/admin/product-types/${editBlank.productTypeId}/variants`, {
        selectedSizeIds: Array.from(editSizeIds),
        selectedColorIds: Array.from(editColorIds),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/product-types"] });
      toast({ title: "Variants updated", description: "Size/colour selection saved for this product." });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save variants", description: parseApiErrorMessage(err), variant: "destructive" });
    },
  });

  const formStyleError = validateCustomizerPageStyleConfig(formStyleConfig);
  const editStyleError = validateCustomizerPageStyleConfig(editStyleConfig);

  /** When moving from Step 1 → Step 2, validate page info before showing the print provider picker */
  function advanceToStep2() {
    if (!formTitle.trim() || !formHandle.trim() || !formProductId) return;
    if (formStyleError) {
      toast({
        title: "Art styles required",
        description: formStyleError,
        variant: "destructive",
      });
      return;
    }
    if (handleAlreadyUsed) {
      toast({
        title: "URL already in use",
        description: `“/pages/${handleAlreadyUsed.handle}” is used by “${handleAlreadyUsed.title}”. Change the URL handle (or title) before continuing.`,
        variant: "destructive",
      });
      return;
    }
    if (titleAlreadyUsedForProduct) {
      toast({
        title: "Page title already used for this product",
        description: `“${titleAlreadyUsedForProduct.title}” already exists (${titleAlreadyUsedForProduct.status === "active" ? "Live" : titleAlreadyUsedForProduct.status}). Use a unique title (e.g. add “UK/EU Only”).`,
        variant: "destructive",
      });
      return;
    }
    if (selectedVariants.length > SHOPIFY_MAX_VARIANTS_PER_PRODUCT) {
      toast({
        title: "Too many variants for Shopify",
        description: `This product has ${selectedVariants.length} variants (max ${SHOPIFY_MAX_VARIANTS_PER_PRODUCT}). Open Products → Edit Variants to reduce sizes or colors.`,
        variant: "destructive",
      });
      return;
    }
    const missingPrimary = !formPrimaryPlaceholder;
    const missingGallery = formGalleryPlaceholders.size < 1;
    if (selectedBlank && (missingPrimary || missingGallery)) {
      const parts = [
        missingPrimary ? "a primary image" : null,
        missingGallery ? "at least one gallery image" : null,
      ].filter(Boolean);
      setPlaceholderStepAlert(`Choose ${parts.join(" and ")} before continuing.`);
      document.getElementById("create-placeholder-images")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }
    // Always visit the print provider step — pricing depends on the chosen supplier's costs.
    setFormStep(2);
  }

  /** Step 2 (print provider) → Step 3 (variants). */
  function advanceFromProvider() {
    if (wizardProviderId == null) {
      toast({
        title: "Choose a print provider",
        description: "Select a Printify supplier before continuing.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedBlank?.printifyBlueprintId) {
      toast({
        title: "Missing Printify blueprint",
        description: "This product is not linked to a Printify blueprint.",
        variant: "destructive",
      });
      return;
    }
    setFormStep(3);
    void loadWizardVariants(selectedBlank.printifyBlueprintId, wizardProviderId);
  }

  /** Step 3 (variants) → Step 4 (pricing). Applies supplier + size/colour picks. */
  function advanceFromVariants() {
    if (!wizardVariantCountValid) {
      toast({
        title: "Select variants",
        description:
          wizardVariantCount > SHOPIFY_MAX_VARIANTS_PER_PRODUCT
            ? `Shopify allows max ${SHOPIFY_MAX_VARIANTS_PER_PRODUCT} variants. Deselect some sizes or colours.`
            : "Wait for sizes/colours to load, then select at least one of each.",
        variant: "destructive",
      });
      return;
    }
    if (prepareProviderMutation.isPending) {
      toast({
        title: "Almost ready",
        description: "Finishing supplier setup so pricing can stay warm — try Next again in a moment.",
      });
      return;
    }
    applySupplierAndVariantsMutation.mutate();
  }

  /** Validate prices in Step 4; advance to Step 5 (confirm). Suggested Printify pricing is required. */
  function advanceToStep4() {
    if (selectedBlankFullyOos) {
      toast({
        title: "Printify stock unavailable",
        description: selectedBlankProviderLabel
          ? `Wait until ${selectedBlankProviderLabel} has stock again (daily OOS report emails when it changes), or go back to Supplier and pick a different print provider.`
          : "Wait until Printify has stock again, or go back to Supplier and pick a different print provider.",
        variant: "destructive",
      });
      return;
    }
    if (!costsAvailable || costsError) {
      toast({
        title: "Suggested prices required",
        description: "Suggested retail prices from Printify are required before creating this page. Wait for costs to finish loading, click Refresh costs, or go back to Supplier and pick a different print provider.",
        variant: "destructive",
      });
      return;
    }
    const errs: Record<string, string> = {};
    for (const v of selectedVariants) {
      const val = variantPrices[v.id] ?? "";
      const num = parseFloat(val);
      if (!val.trim() || isNaN(num) || num <= 0) {
        errs[v.id] = "Required — enter a front-only price greater than $0.00";
        continue;
      }
      if (supportsBothSidePricing) {
        const bothVal = variantPricesBoth[v.id] ?? "";
        const bothNum = parseFloat(bothVal);
        if (!bothVal.trim() || isNaN(bothNum) || bothNum <= 0) {
          errs[v.id] = "Required — enter a front+back price greater than $0.00";
        } else if (bothNum < num) {
          errs[v.id] = "Front+back price should be at least the front-only price";
        }
      }
    }
    if (Object.keys(errs).length > 0) {
      setPriceErrors(errs);
      return;
    }
    setPriceErrors({});
    setConfirmedVariants(selectedVariants);
    setFormStep(5);
  }

  function handleSubmitCreate() {
    if (!formStyleConfig || formStyleError) {
      toast({
        title: "Art styles required",
        description: formStyleError ?? "Choose art styles before creating this page.",
        variant: "destructive",
      });
      return;
    }
    // For products on Shopify: pass their shopify productId.
    // For products not yet on Shopify: pass the productTypeId so the backend can auto-send.
    const isSync = selectedBlank?.needsShopifySync;
    const curated = buildCuratedPlaceholderPayload(
      formPrimaryPlaceholder,
      formGalleryPlaceholders,
      selectedBlank?.baseMockupImages?.custom,
      formCustomPlaceholder,
    );
    createMutation.mutate({
      title: stripProviderSuffix(formTitle.trim()) || formTitle.trim(),
      handle: formHandle,
      baseProductId: isSync ? undefined : formProductId,
      productTypeId: isSync ? selectedBlank?.productTypeId : undefined,
      variantPrices,
      ...(supportsBothSidePricing ? { variantPricesBoth } : {}),
      styleConfig: formStyleConfig,
      baseMockupImages: curated,
    });
  }

  const { data: catalogForFilters } = useQuery<{
    entries: Array<{ blueprintId: number; category: string | null }>;
  }>({
    queryKey: ["/api/appai/setup/catalog"],
  });

  const categoryByBlueprint = useMemo(() => {
    const map = new Map<number, string>();
    for (const e of catalogForFilters?.entries ?? []) {
      if (e.category) map.set(e.blueprintId, e.category);
    }
    return map;
  }, [catalogForFilters?.entries]);

  const pages = pagesData?.pages ?? [];

  /** productTypeId → Live / any customizer pages (for Create dropdown labels + uniqueness). */
  const pagesForProductType = useMemo(() => {
    const map = new Map<number, CustomizerPage[]>();
    for (const p of pages) {
      if (p.productTypeId == null) continue;
      const list = map.get(p.productTypeId) ?? [];
      list.push(p);
      map.set(p.productTypeId, list);
    }
    return map;
  }, [pages]);

  const liveProductTypeIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of pages) {
      if (p.status === "active" && p.productTypeId != null) ids.add(p.productTypeId);
    }
    return ids;
  }, [pages]);

  const sortedCreateBlanks = useMemo(() => {
    const blanks = [...(blanksData?.blanks ?? [])];
    blanks.sort((a, b) => {
      const aLive = liveProductTypeIds.has(a.productTypeId) ? 0 : 1;
      const bLive = liveProductTypeIds.has(b.productTypeId) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    // Repeated catalogue activation can leave several active productType rows for
    // the same blueprint/title, which showed up as duplicate dropdown options.
    // Collapse by product identity (synced product id, else blueprint+title),
    // keeping the first — the sort above already puts a live/synced row first.
    const seen = new Set<string>();
    const deduped: typeof blanks = [];
    for (const b of blanks) {
      const key = b.productId
        ? `id:${b.productId}`
        : b.printifyBlueprintId != null
          ? `bp:${b.printifyBlueprintId}:${b.title.trim().toLowerCase()}`
          : `pt:${b.productTypeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(b);
    }
    return deduped;
  }, [blanksData?.blanks, liveProductTypeIds]);

  const handleAlreadyUsed = useMemo(() => {
    const h = formHandle.trim();
    if (!h) return null;
    return pages.find((p) => p.handle === h) ?? null;
  }, [formHandle, pages]);

  const titleAlreadyUsedForProduct = useMemo(() => {
    if (!selectedBlank || !formTitle.trim()) return null;
    const titleNorm = formTitle.trim().toLowerCase();
    return (
      pages.find(
        (p) =>
          p.productTypeId === selectedBlank.productTypeId &&
          p.title.trim().toLowerCase() === titleNorm,
      ) ?? null
    );
  }, [formTitle, pages, selectedBlank]);

  const existingPagesForSelectedProduct = selectedBlank
    ? pagesForProductType.get(selectedBlank.productTypeId) ?? []
    : [];

  const filteredPages = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return pages.filter((page) => {
      if (listStatus !== "all" && page.status !== listStatus) return false;
      if (q) {
        const hay = [page.title, page.handle, page.baseProductTitle]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (listCategory !== "all") {
        const blank = blanksData?.blanks.find((b) => b.productTypeId === page.productTypeId);
        const cat =
          blank?.printifyBlueprintId != null
            ? categoryByBlueprint.get(blank.printifyBlueprintId)
            : undefined;
        if (cat !== listCategory) return false;
      }
      return true;
    });
  }, [pages, listSearch, listStatus, listCategory, blanksData?.blanks, categoryByBlueprint]);

  const limit = pagesData?.limit ?? 0;
  const count = pagesData?.count ?? 0;
  const planName = pagesData?.planName ?? null;
  const planStatus = pagesData?.planStatus ?? null;
  const requiresPlan = pagesData?.requiresPlan ?? false;
  const overLimit = pagesData?.overLimit ?? false;
  const atLimit = false; // We allow unlimited creation now, only restrict activation

  if (reauthData) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center px-4">
          <AlertTriangle className="h-12 w-12 text-yellow-500" />
          <h2 className="text-xl font-semibold">Shopify connection needs to be refreshed</h2>
          <p className="text-muted-foreground max-w-sm">
            Your app's Shopify access token has expired or been revoked. Click below to reconnect
            your store — this only takes a moment.
          </p>
          <Button
            size="lg"
            onClick={() => window.open(reauthData.reinstallUrl, "_top")}
          >
            Reconnect Shopify
          </Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutTemplate className="h-6 w-6 text-primary" />
              Customizer Pages
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create Page chooses Printify supplier and applies suggested retail before going Live.
            </p>
          </div>

          {/* Only show Create button if plan is active */}
          {!requiresPlan && (
            <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) resetForm(); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Page
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg flex flex-col max-h-[min(90vh,700px)] overflow-hidden">
                <DialogHeader className="shrink-0">
                  <DialogTitle>
                    {formStep === 6 ? "Page Created!" : "Create Customizer Page"}
                  </DialogTitle>
                  {formStep < 6 && (
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      {([1, 2, 3, 4, 5] as const).map((s) => (
                        <div key={s} className="flex items-center gap-1.5">
                          <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                            formStep === s
                              ? "bg-primary text-primary-foreground"
                              : formStep > s
                              ? "bg-primary/20 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}>{s}</div>
                          <span className={`text-xs ${formStep === s ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                            {s === 1
                              ? "Page info"
                              : s === 2
                                ? "Supplier"
                                : s === 3
                                  ? "Variants"
                                  : s === 4
                                    ? "Pricing"
                                    : "Confirm"}
                          </span>
                          {s < 5 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      ))}
                    </div>
                  )}
                </DialogHeader>

                {/* ── STEP 1: Page info ── */}
                {formStep === 1 && (
                  <div className="flex flex-col min-h-0 flex-1 pt-2">
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
                    {/* Product first */}
                    <div>
                      <Label>Product</Label>
                      {blanksLoading || ensureCatalogProductMutation.isPending ? (
                        <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-input bg-muted/30 px-3">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground">
                            {ensureCatalogProductMutation.isPending
                              ? "Preparing product from catalogue…"
                              : "Loading Products…"}
                          </span>
                        </div>
                      ) : (blanksData?.blanks ?? []).length === 0 &&
                        (setupCatalogData?.entries ?? []).length === 0 ? (
                        <p className="text-sm text-destructive mt-1">
                          No products found. Open Products Catalogue or ask an operator to publish items.
                        </p>
                      ) : (
                        <Select
                          value={formProductId}
                          onValueChange={(val) => {
                            if (val.startsWith("bp:")) {
                              const bpId = parseInt(val.slice(3), 10);
                              if (Number.isFinite(bpId)) ensureCatalogProductMutation.mutate(bpId);
                              return;
                            }
                            setFormProductId(val);
                          }}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select a product…" />
                          </SelectTrigger>
                          <SelectContent>
                            {sortedCreateBlanks.map((blank) => {
                              const val = blank.productId ? blank.productId : `pt:${blank.productTypeId}`;
                              const isLive = liveProductTypeIds.has(blank.productTypeId);
                              return (
                                <SelectItem key={val} value={val}>
                                  {blank.title}
                                  {isLive ? " (Live)" : ""}
                                  {/* A live page means the product already exists on
                                      this store — never contradict it with "will be
                                      created" even if Admin sync resolution is stale. */}
                                  {blank.needsShopifySync && !isLive
                                    ? " (not on this store yet — will be created)"
                                    : ""}
                                </SelectItem>
                              );
                            })}
                            {(setupCatalogData?.entries ?? [])
                              .filter((entry) => {
                                const blanks = blanksData?.blanks ?? [];
                                return !blanks.some(
                                  (b) =>
                                    b.printifyBlueprintId === entry.blueprintId ||
                                    (entry.existingProductType != null &&
                                      b.productTypeId === entry.existingProductType.id),
                                );
                              })
                              .map((entry) => (
                                <SelectItem
                                  key={`bp:${entry.blueprintId}`}
                                  value={`bp:${entry.blueprintId}`}
                                >
                                  {entry.label} (from catalogue — will be prepared)
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                      {selectedBlank && existingPagesForSelectedProduct.length > 0 && (
                        <p className="text-xs text-amber-800 mt-1 rounded-md border border-amber-200 bg-amber-50 p-2">
                          This product already has{" "}
                          {existingPagesForSelectedProduct.length === 1
                            ? "a customizer page"
                            : `${existingPagesForSelectedProduct.length} customizer pages`}
                          {" "}
                          (
                          {existingPagesForSelectedProduct
                            .map((p) => `${p.title} · /pages/${p.handle}${p.status === "active" ? " · Live" : ""}`)
                            .join("; ")}
                          ). Use a unique page title and URL handle, or edit the existing page instead.
                        </p>
                      )}
                      {selectedBlank?.needsShopifySync &&
                      !(selectedBlank && liveProductTypeIds.has(selectedBlank.productTypeId)) ? (
                        <p className="text-xs text-muted-foreground mt-1">
                          This product is not on Shopify in this store yet — finishing Create Page will
                          send it. Deleting a customizer page does not remove the Shopify product, so
                          products that were already sent stay listed without “will be created”.
                        </p>
                      ) : null}
                      {selectedVariants.length > SHOPIFY_MAX_VARIANTS_PER_PRODUCT ? (
                        <p className="text-xs text-destructive mt-1">
                          {selectedVariants.length} variants — Shopify allows {SHOPIFY_MAX_VARIANTS_PER_PRODUCT} max.
                          Open Products → Edit Variants to reduce before continuing.
                        </p>
                      ) : null}
                    </div>

                    {selectedBlank && formStyleConfig && (
                      <CustomizerPageStyleSelector
                        designerType={selectedBlank.designerType}
                        availableStyles={adminStyles}
                        value={formStyleConfig}
                        onChange={setFormStyleConfig}
                      />
                    )}

                    <div>
                      <Label htmlFor="title">Page Title</Label>
                      <Input
                        id="title"
                        placeholder="e.g. Custom Pillow"
                        value={formTitle}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Auto-filled from product name — feel free to edit.
                      </p>
                      {titleAlreadyUsedForProduct && (
                        <p className="text-xs text-destructive mt-1 font-medium">
                          This title is already used for this product
                          {titleAlreadyUsedForProduct.status === "active" ? " (Live)" : ""}. Choose a
                          unique title before continuing.
                        </p>
                      )}
                    </div>

                    <div>
                      <Label htmlFor="handle">URL Handle</Label>
                      <div className="flex items-center mt-1">
                        <div className="bg-muted px-3 py-2 rounded-l-md border border-r-0 text-sm text-muted-foreground">
                          /pages/
                        </div>
                        <Input
                          id="handle"
                          placeholder="custom-pillow"
                          value={formHandle}
                          onChange={(e) => { setHandleTouched(true); setFormHandle(slugify(e.target.value)); }}
                          className={`rounded-l-none ${handleAlreadyUsed ? "border-destructive" : ""}`}
                        />
                      </div>
                      {handleAlreadyUsed ? (
                        <p className="text-xs text-destructive mt-1 font-medium">
                          /pages/{formHandle} is already used by “{handleAlreadyUsed.title}”. Change the
                          handle before continuing.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          Storefront URL: /pages/{formHandle || "..."}
                        </p>
                      )}
                    </div>

                    {selectedBlank && (
                      <div id="create-placeholder-images" className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-sm font-semibold">Placeholder images (required)</Label>
                          <span className="text-xs text-muted-foreground text-right max-w-[22rem]">
                            Choose 1 primary and at least 1 gallery image (up to {MAX_GALLERY_PLACEHOLDERS}).
                            Primary is your marketing hero — on the storefront the selected colour
                            blank leads when available; your Primary stays in the carousel.
                          </span>
                        </div>
                        {(() => {
                          const available = buildAvailablePlaceholderImages(
                            selectedBlank.baseMockupImages,
                            formCustomPlaceholder || undefined,
                          );
                          if (available.length === 0) {
                            return (
                              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                                No placeholder images yet. Upload one below, or refresh images from the Products admin page.
                              </p>
                            );
                          }
                          return (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-md border p-2">
                              {available.map((img, index) => {
                                const isPrimary = formPrimaryPlaceholder === img.url;
                                const isGallery = formGalleryPlaceholders.has(img.url);
                                return (
                                  <div
                                    key={`${img.url}-${index}`}
                                    className={`relative rounded-md border p-2 space-y-2 ${isPrimary ? "ring-2 ring-primary" : ""}`}
                                  >
                                    {isPrimary && (
                                      <span className="absolute right-2 top-2 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow">
                                        Primary
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="block w-full overflow-hidden rounded bg-muted"
                                      onClick={() => setFormPrimaryPlaceholder(img.url)}
                                    >
                                      <img src={img.url} alt={img.label} className="h-24 w-full object-cover" />
                                    </button>
                                    <p className="truncate text-xs font-medium">{img.label}</p>
                                    <div className="flex items-center justify-between gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={isPrimary ? "default" : "outline"}
                                        className="h-7 px-2 text-xs"
                                        onClick={() => setFormPrimaryPlaceholder(img.url)}
                                      >
                                        Primary
                                      </Button>
                                      <label className="flex items-center gap-1 text-xs">
                                        <input
                                          type="checkbox"
                                          checked={isGallery}
                                          disabled={!isGallery && formGalleryPlaceholders.size >= MAX_GALLERY_PLACEHOLDERS}
                                          onChange={() => toggleFormGalleryPlaceholder(img.url)}
                                        />
                                        Gallery
                                      </label>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp"
                            className="hidden"
                            id="create-placeholder-upload"
                            onChange={handleFormPlaceholderUpload}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById("create-placeholder-upload")?.click()}
                            disabled={uploadingPlaceholder}
                          >
                            {uploadingPlaceholder ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4 mr-2" />
                            )}
                            Upload Custom Image
                          </Button>
                        </div>
                      </div>
                    )}

                    </div>

                    {selectedBlank && (
                      <p className={`text-xs mt-2 shrink-0 ${formPrimaryPlaceholder && formGalleryPlaceholders.size > 0 ? "text-muted-foreground" : "text-amber-800"}`}>
                        {formPrimaryPlaceholder && formGalleryPlaceholders.size > 0
                          ? `Primary + ${formGalleryPlaceholders.size} gallery image${formGalleryPlaceholders.size === 1 ? "" : "s"} selected.`
                          : "Scroll down and choose a primary image plus at least one gallery image."}
                      </p>
                    )}
                    <Button
                      className="w-full mt-3 shrink-0"
                      disabled={
                        !formTitle.trim() ||
                        !formHandle.trim() ||
                        !formProductId ||
                        !!formStyleError ||
                        !!handleAlreadyUsed ||
                        !!titleAlreadyUsedForProduct ||
                        selectedVariants.length > SHOPIFY_MAX_VARIANTS_PER_PRODUCT
                      }
                      onClick={advanceToStep2}
                    >
                      Next: Print Provider <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}

                {/* ── STEP 2: Print provider ── */}
                {formStep === 2 && (
                  <div className="flex flex-col min-h-0 flex-1 pt-2">
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Choose the Printify supplier that will produce{" "}
                        <strong>{selectedBlank?.title}</strong>. Switching suppliers can change
                        production costs and suggested retail pricing.
                      </p>
                      {!selectedBlank?.printifyBlueprintId ? (
                        <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3">
                          This product is not linked to a Printify blueprint, so no suppliers are available.
                        </p>
                      ) : wizardProvidersLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          <span className="text-sm text-muted-foreground">Loading print providers…</span>
                        </div>
                      ) : (wizardProvidersData ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground rounded-md border p-3">
                          No print providers found for this product.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {wizardProvidersData!.map((provider) => {
                            const isSelected = wizardProviderId === provider.id;
                            const isCurrent = provider.id === selectedBlank?.printifyProviderId;
                            const shipsTo = (provider.fulfillment_countries ?? []).slice(0, 6).join(", ");
                            const methods = (provider.decoration_methods ?? [])
                              .map((m) => String(m).toUpperCase())
                              .join(" · ");
                            const fromPrice =
                              provider.pricingFromCents != null && provider.pricingFromCents > 0
                                ? (provider.pricingFromCents / 100).toFixed(2)
                                : null;
                            const variantLabel =
                              provider.variantCount != null && provider.variantCount > 0
                                ? `${provider.variantCount} variants`
                                : null;
                            return (
                              <button
                                key={provider.id}
                                type="button"
                                className={`w-full flex items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors ${
                                  isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                                }`}
                                onClick={() => setWizardProviderId(provider.id)}
                              >
                                <span className="min-w-0 space-y-0.5">
                                  <span className="text-sm font-medium block truncate">{provider.title}</span>
                                  <span className="text-xs text-muted-foreground block">
                                    {provider.location?.country
                                      ? `Ships from ${provider.location.country}`
                                      : "Shipping origin unknown"}
                                    {shipsTo ? ` · Ships to ${shipsTo}${((provider.fulfillment_countries ?? []).length > 6) ? "…" : ""}` : ""}
                                  </span>
                                  <span className="text-xs text-muted-foreground block">
                                    {[
                                      methods || null,
                                      fromPrice ? `From ~$${fromPrice}` : "From price pending sync",
                                      variantLabel,
                                      provider.supportsBothSides ? "Front + back print" : null,
                                      provider.rating != null ? `Rating ${provider.rating.toFixed(1)}` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                </span>
                                <span className="flex items-center gap-2 shrink-0">
                                  {isCurrent && (
                                    <Badge variant="outline" className="text-[10px]">Current</Badge>
                                  )}
                                  {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 pt-2 shrink-0">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setFormStep(1)}
                      >
                        Back
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={advanceFromProvider}
                        disabled={wizardProviderId == null}
                      >
                        Next: Variants <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── STEP 3: Variants ── */}
                {formStep === 3 && (
                  <div className="flex flex-col min-h-0 flex-1 pt-2">
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Choose sizes and colours for{" "}
                        <strong>{wizardProviderLabel ?? "this supplier"}</strong>. Shopify allows up to{" "}
                        {SHOPIFY_MAX_VARIANTS_PER_PRODUCT} variants.
                      </p>
                      {(prepareProviderMutation.isPending ||
                        (costsLoading && formStep === 3) ||
                        (costsAvailable && formStep === 3)) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                          {(prepareProviderMutation.isPending || (costsLoading && !costsAvailable)) && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                          )}
                          {prepareProviderMutation.isPending
                            ? "Preparing supplier in the background…"
                            : costsLoading && !costsAvailable
                              ? "Loading suggested pricing in the background — this can take up to a minute."
                              : costsAvailable
                                ? "Suggested pricing is ready — continue when you’ve finished picking variants."
                                : null}
                        </p>
                      )}
                      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                        <span className="text-sm font-medium">Total variants</span>
                        <span
                          className={`text-lg font-bold ${
                            wizardVariantCountValid ? "text-green-600" : "text-destructive"
                          }`}
                        >
                          {wizardVariantCount}
                        </span>
                      </div>
                      {wizardVariantsLoading ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="text-sm text-muted-foreground">Loading sizes &amp; colours…</p>
                        </div>
                      ) : (
                        <>
                          {wizardSizes.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">
                                  Sizes ({wizardSizeIds.size}/{wizardSizes.length})
                                </Label>
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setWizardSizeIds(new Set(wizardSizes.map((s) => s.id)))}
                                  >
                                    Select all
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setWizardSizeIds(new Set())}
                                  >
                                    Clear
                                  </Button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
                                {wizardSizes.map((size) => (
                                  <label
                                    key={size.id}
                                    className="flex items-center gap-2 p-1.5 hover:bg-muted rounded cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={wizardSizeIds.has(size.id)}
                                      onCheckedChange={() => {
                                        setWizardSizeIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(size.id)) next.delete(size.id);
                                          else next.add(size.id);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span className="text-sm">{size.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {wizardColors.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">
                                  Colours ({wizardColorIds.size}/{wizardColors.length})
                                </Label>
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setWizardColorIds(new Set(wizardColors.map((c) => c.id)))}
                                  >
                                    Select all
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setWizardColorIds(new Set())}
                                  >
                                    Clear
                                  </Button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
                                {wizardColors.map((color) => (
                                  <label
                                    key={color.id}
                                    className="flex items-center gap-2 p-1.5 hover:bg-muted rounded cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={wizardColorIds.has(color.id)}
                                      onCheckedChange={() => {
                                        setWizardColorIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(color.id)) next.delete(color.id);
                                          else next.add(color.id);
                                          return next;
                                        });
                                      }}
                                    />
                                    {color.hex ? (
                                      <span
                                        className="h-3 w-3 rounded-full border shrink-0"
                                        style={{ backgroundColor: color.hex }}
                                      />
                                    ) : null}
                                    <span className="text-sm truncate">{color.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {!wizardVariantsReady && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (selectedBlank?.printifyBlueprintId && wizardProviderId != null) {
                                  void loadWizardVariants(selectedBlank.printifyBlueprintId, wizardProviderId);
                                }
                              }}
                            >
                              Retry load variants
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex gap-2 pt-2 shrink-0">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setFormStep(2)}
                        disabled={applySupplierAndVariantsMutation.isPending}
                      >
                        Back
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={advanceFromVariants}
                        disabled={!wizardVariantCountValid || applySupplierAndVariantsMutation.isPending}
                      >
                        {applySupplierAndVariantsMutation.isPending ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Applying…</>
                        ) : (
                          <>Next: Set Pricing <ChevronRight className="h-4 w-4 ml-1" /></>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── STEP 4: Pricing ── */}
                {formStep === 4 && (
                  <div className="flex flex-col min-h-0 flex-1 pt-2">
                    {blanksLoading ? (
                      <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Loading variants…</p>
                      </div>
                    ) : costsLoading && !costsAvailable ? (
                      <div className="flex flex-col items-center justify-center py-14 gap-3 px-4 text-center">
                        <Loader2 className="h-10 w-10 animate-spin text-primary" />
                        <p className="text-sm font-medium">Loading Printify production costs…</p>
                        <p className="text-xs text-muted-foreground max-w-sm">
                          This can take up to a minute depending on the product (especially tees with many
                          size/colour combinations). Keep this window open — suggested retail prices appear
                          when costs finish.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void refetchCosts()}
                          disabled={costsLoading}
                        >
                          Still waiting? Retry
                        </Button>
                      </div>
                    ) : (
                    <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Set a retail price for each variant
                        {supportsBothSidePricing ? " (front-only and front+back)." : "."}
                      </p>
                      <Dialog open={costsOpen} onOpenChange={setCostsOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Info className="h-4 w-4 mr-2" />
                            Printify Costs
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              <DollarSign className="h-5 w-5 text-emerald-600" />
                              Production & Shipping Costs
                            </DialogTitle>
                            <p className="text-sm text-muted-foreground">
                              Estimated costs for <strong>{selectedBlank?.title}</strong>.
                            </p>
                          </DialogHeader>

                          <Tabs value={costsActiveTab} onValueChange={(v: any) => setCostsActiveTab(v)} className="mt-2">
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger value="production" className="flex items-center gap-1.5">
                                <Factory className="h-3.5 w-3.5 shrink-0" />
                                <span className={costsActiveTab === "production" ? "shimmer-text" : ""}>
                                  Production
                                </span>
                              </TabsTrigger>
                              <TabsTrigger value="shipping" className="flex items-center gap-1.5">
                                <Truck className="h-3.5 w-3.5 shrink-0" />
                                <span className={costsActiveTab === "shipping" ? "shimmer-text" : ""}>
                                  Shipping
                                </span>
                              </TabsTrigger>
                            </TabsList>

                            {/* Production tab */}
                            <TabsContent value="production" className="space-y-4 pt-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="markup" className="text-sm font-medium">Global Markup</Label>
                                  <div className="flex items-center gap-1">
                                    <Input
                                      id="markup"
                                      type="number"
                                      className="w-16 h-8"
                                      value={markupPercent}
                                      onChange={(e) => setMarkupPercent(Number(e.target.value))}
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedBlank?.productTypeId) return;
                                    productSyncMutation.mutate(selectedBlank.productTypeId, {
                                      onSuccess: () => void refetchCosts(),
                                    });
                                  }}
                                  disabled={productSyncMutation.isPending || costsLoading}
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${productSyncMutation.isPending ? 'animate-spin' : ''}`} />
                                  Refresh Costs
                                </Button>
                              </div>

                              {costsLoading ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                  <span className="text-sm text-muted-foreground">Fetching Printify costs...</span>
                                </div>
                              ) : costsData?.costs || costsData?.shopifyVariantCosts ? (
                                <>
                                  <div className="rounded-md border text-sm">
                                    <div className={`grid gap-2 px-3 py-2 bg-muted font-medium ${supportsBothSidePricing ? "grid-cols-5" : "grid-cols-3"}`}>
                                      <span>Variant</span>
                                      <span className="text-right">Front cost</span>
                                      {supportsBothSidePricing && <span className="text-right">Front+back</span>}
                                      <span className="text-right text-emerald-700">Premium (est.)</span>
                                      {supportsBothSidePricing && <span className="text-right text-emerald-700">Prem. both</span>}
                                    </div>
                                    {selectedVariants.length > 0 ? selectedVariants.map((v) => {
                                      const labelToCost: Record<string, number> = {};
                                      if (costsData.printifyVariantLabels && costsData.costs) {
                                        for (const [printifyVid, label] of Object.entries(costsData.printifyVariantLabels)) {
                                          const c = costsData.costs[printifyVid];
                                          if (c != null) labelToCost[label.toLowerCase().trim()] = c;
                                        }
                                      }
                                      const costCents = resolveBlankVariantCostCents(v, costsData, labelToCost);
                                      const labelToBoth: Record<string, number> = {};
                                      if (costsData.printifyVariantLabels && costsData.costsBoth) {
                                        for (const [printifyVid, label] of Object.entries(costsData.printifyVariantLabels)) {
                                          const c = costsData.costsBoth[printifyVid];
                                          if (c != null) labelToBoth[label.toLowerCase().trim()] = c;
                                        }
                                      }
                                      const bothCents = supportsBothSidePricing
                                        ? resolveBlankVariantCostCents(v, { ...costsData, costs: costsData.costsBoth || {} }, labelToBoth)
                                        : null;
                                      return (
                                        <div key={v.id} className={`grid gap-2 px-3 py-2 border-t ${supportsBothSidePricing ? "grid-cols-5" : "grid-cols-3"}`}>
                                          <span className="truncate">{v.title}</span>
                                          <span className="text-right font-mono">
                                            {costCents != null ? `$${(costCents / 100).toFixed(2)}` : "—"}
                                          </span>
                                          {supportsBothSidePricing && (
                                            <span className="text-right font-mono">
                                              {bothCents != null ? `$${(bothCents / 100).toFixed(2)}` : "—"}
                                            </span>
                                          )}
                                          <span className="text-right font-mono text-emerald-600">
                                            {costCents != null ? `$${(costCents * 0.8 / 100).toFixed(2)}` : "—"}
                                          </span>
                                          {supportsBothSidePricing && (
                                            <span className="text-right font-mono text-emerald-600">
                                              {bothCents != null ? `$${(bothCents * 0.8 / 100).toFixed(2)}` : "—"}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    }) : Object.entries(costsData.costs).map(([vid, costCents]) => (
                                      <div key={vid} className={`grid gap-2 px-3 py-2 border-t ${supportsBothSidePricing ? "grid-cols-5" : "grid-cols-3"}`}>
                                        <span className="text-muted-foreground">Variant {vid}</span>
                                        <span className="text-right font-mono">${(Number(costCents) / 100).toFixed(2)}</span>
                                        {supportsBothSidePricing && (
                                          <span className="text-right font-mono">
                                            {costsData.costsBoth?.[vid] != null
                                              ? `$${(Number(costsData.costsBoth[vid]) / 100).toFixed(2)}`
                                              : "—"}
                                          </span>
                                        )}
                                        <span className="text-right font-mono text-emerald-600">${(Number(costCents) * 0.8 / 100).toFixed(2)}</span>
                                        {supportsBothSidePricing && (
                                          <span className="text-right font-mono text-emerald-600">
                                            {costsData.costsBoth?.[vid] != null
                                              ? `$${(Number(costsData.costsBoth[vid]) * 0.8 / 100).toFixed(2)}`
                                              : "—"}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Premium estimates based on up to 20% Printify Premium discount. Shipping costs are separate.
                                    {supportsBothSidePricing
                                      ? " Front+back costs include Printify’s extra print-area charge."
                                      : ""}
                                  </p>
                                  {costsData.cached && (
                                    <p className="text-xs text-muted-foreground">Cached data. Use the Refresh button above to fetch the latest costs.</p>
                                  )}
                                </>
                              ) : (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                  Production cost data is not available for this product. Ensure your Printify API token and Shop ID are configured in Settings.
                                </p>
                              )}
                            </TabsContent>

                            {/* Shipping tab */}
                            <TabsContent value="shipping" className="space-y-3 pt-2">
                              {shippingLoading ? (
                                <div className="flex items-center justify-center py-8">
                                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                  <span className="text-sm text-muted-foreground">Loading shipping rates...</span>
                                </div>
                              ) : shippingData?.tiers && shippingData.shipping ? (
                                <>
                                  <div className="flex gap-2 flex-wrap items-center">
                                    {shippingData.tiers.map((tier) => (
                                      <Button
                                        key={tier}
                                        variant={costsShippingTier === tier ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCostsShippingTier(tier)}
                                        className="capitalize"
                                      >
                                        {tier}
                                      </Button>
                                    ))}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => productSyncMutation.mutate()}
                                      disabled={productSyncMutation.isPending || costsLoading || !selectedBlank?.productTypeId}
                                      className="ml-auto shrink-0"
                                      title="Sync COGS and availability from Printify into Product Intelligence"
                                    >
                                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${productSyncMutation.isPending ? 'animate-spin' : ''}`} />
                                      Product Sync
                                    </Button>
                                  </div>
                                  {shippingData.countries && shippingData.countries.length > 0 && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium whitespace-nowrap">Country</span>
                                      <Select value={costsShippingCountry} onValueChange={setCostsShippingCountry}>
                                        <SelectTrigger className="flex-1">
                                          <SelectValue placeholder="Select country" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {(() => {
                                            const sorted = [...shippingData.countries].sort((a, b) => {
                                              if (a === "US") return -1;
                                              if (b === "US") return 1;
                                              if (a === "REST_OF_THE_WORLD") return -1;
                                              if (b === "REST_OF_THE_WORLD") return 1;
                                              return a.localeCompare(b);
                                            });
                                            return sorted.map((c) => (
                                              <SelectItem key={c} value={c}>
                                                {c === "REST_OF_THE_WORLD" ? "Rest of the World" : c}
                                              </SelectItem>
                                            ));
                                          })()}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )}
                                  {(() => {
                                    const tierEntries = (shippingData.shipping[costsShippingTier] ?? [])
                                      .filter((e) => e.country === costsShippingCountry);
                                    if (tierEntries.length === 0) {
                                      return <p className="text-sm text-muted-foreground text-center py-4">No shipping data for this tier/country combination.</p>;
                                    }
                                    const handlingTime = tierEntries[0]?.handlingTime;
                                    return (
                                      <>
                                        {handlingTime && (
                                          <p className="text-xs text-muted-foreground">
                                            Handling time: {handlingTime.from}–{handlingTime.to} business days
                                          </p>
                                        )}
                                        <div className="rounded-md border text-sm">
                                          <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-muted font-medium">
                                            <span>Variant</span>
                                            <span className="text-right">1st Item</span>
                                            <span className="text-right">Additional</span>
                                          </div>
                                          {(() => {
                                            const seen = new Set<string>();
                                            return tierEntries.filter((entry) => {
                                              const label = selectedBlank?.printifyVariantLabels?.[String(entry.variantId)]
                                                ?? costsData?.printifyVariantLabels?.[String(entry.variantId)]
                                                ?? `Variant ${entry.variantId}`;
                                              const key = `${label}|${entry.firstItem}|${entry.additionalItems}`;
                                              if (seen.has(key)) return false;
                                              seen.add(key);
                                              return true;
                                            }).map((entry) => {
                                              const variantTitle = selectedBlank?.printifyVariantLabels?.[String(entry.variantId)]
                                                ?? costsData?.printifyVariantLabels?.[String(entry.variantId)]
                                                ?? `Variant ${entry.variantId}`;
                                              return (
                                                <div key={entry.variantId} className="grid grid-cols-3 gap-2 px-3 py-2 border-t">
                                                  <span className="truncate">{variantTitle}</span>
                                                  <span className="text-right font-mono">${(entry.firstItem / 100).toFixed(2)}</span>
                                                  <span className="text-right font-mono">${(entry.additionalItems / 100).toFixed(2)}</span>
                                                </div>
                                              );
                                            });
                                          })()}
                                        </div>
                                      </>
                                    );
                                  })()}
                                </>
                              ) : (
                                <p className="text-sm text-muted-foreground py-4 text-center">
                                  Shipping data is not available for this product.
                                </p>
                              )}
                            </TabsContent>
                          </Tabs>
                          <p className="text-xs text-muted-foreground border-t pt-3">
                            Set your retail price above production + shipping costs to ensure profitability.
                          </p>
                        </DialogContent>
                      </Dialog>
                    </div>

                    <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg border">
                      <div className="flex-1">
                        <Label htmlFor="markup-main" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Markup</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            id="markup-main"
                            type="number"
                            className="w-20"
                            value={markupPercent}
                            onChange={(e) => setMarkupPercent(Number(e.target.value))}
                          />
                          <span className="text-sm font-medium">%</span>
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-10"
                        onClick={() => {
                          const next: Record<string, string> = {};
                          for (const [id, price] of Object.entries(recommendedPrices)) {
                            next[id] = price;
                          }
                          setVariantPrices(next);
                          if (supportsBothSidePricing) {
                            const nextBoth: Record<string, string> = {};
                            for (const [id, price] of Object.entries(recommendedPricesBoth)) {
                              nextBoth[id] = price;
                            }
                            setVariantPricesBoth(nextBoth);
                          }
                        }}
                      >
                        Apply All Suggested
                      </Button>
                    </div>

                    {!selectedBlank?.printifyBlueprintId && (
                      <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3">
                        This product is not linked to Printify (no blueprint). Import it from Printify in Products, or pick a product with production cost data.
                      </p>
                    )}

                    {selectedBlankFullyOos && (
                      <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                        <span className="font-medium block">
                          Printify stock is currently unavailable
                          {selectedBlankProviderLabel ? ` for ${selectedBlankProviderLabel}` : ""}.
                        </span>
                        <span className="block text-destructive/90">
                          Suggested retail can’t be calculated until variants are back in stock for this supplier.
                          The daily catalogue stock report will email when status changes — or use Scan stock now on the page list anytime.
                        </span>
                        {selectedBlank?.productTypeId != null && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={scanStockMutation.isPending}
                            onClick={() => {
                              scanStockMutation.mutate(selectedBlank.productTypeId, {
                                onSuccess: () => {
                                  void refetchCosts();
                                  queryClient.invalidateQueries({ queryKey: ["/api/appai/blanks"] });
                                },
                              });
                            }}
                          >
                            {scanStockMutation.isPending ? "Scanning…" : "Scan stock now"}
                          </Button>
                        )}
                      </p>
                    )}

                    {costsError && !selectedBlankFullyOos && (
                      <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-3 flex flex-wrap items-center gap-2">
                        <span>
                          {parseApiErrorMessage((costsFetchError as Error)?.message ?? "Could not load Printify production costs.")}
                          {" "}Retry runs Product Sync then a Printify cost probe — apparel can take up to a minute.
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={productSyncMutation.isPending || costsLoading}
                          onClick={async () => {
                            const ptId = selectedBlank?.productTypeId;
                            if (ptId) {
                              try {
                                await productSyncMutation.mutateAsync(ptId);
                              } catch {
                                /* still try legacy costs */
                              }
                            }
                            try {
                              const res = await apiRequest(
                                "GET",
                                `/api/admin/printify/costs/${ptId}?legacy=1`,
                              );
                              if (res.ok) {
                                const data = await res.json();
                                queryClient.setQueryData(
                                  ["/api/admin/printify/costs", ptId],
                                  data,
                                );
                                return;
                              }
                            } catch {
                              /* fall through */
                            }
                            void refetchCosts();
                          }}
                        >
                          {productSyncMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : null}
                          Retry
                        </Button>
                      </p>
                    )}

                    {!costsError && selectedBlank?.oosStatus === "critical" && (
                      <p className="text-sm text-amber-800 rounded-md border border-amber-200 bg-amber-50 p-3">
                        Most variants are out of stock
                        {selectedBlankProviderLabel ? ` at ${selectedBlankProviderLabel}` : ""}
                        {" "}({selectedBlank.oosAvailableVariants ?? 0}/{selectedBlank.oosTotalVariants ?? 0} available).
                        You can still set prices for in-stock options.
                      </p>
                    )}

                    {!costsLoading && !costsError && selectedBlank?.printifyBlueprintId && !costsAvailable && (
                      <p className="text-sm text-amber-800 rounded-md border border-amber-200 bg-amber-50 p-3 flex flex-wrap items-center gap-2">
                        <span>
                          Loading production costs from Printify… If this persists, open Printify Costs or click Refresh costs.
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => {
                            if (!selectedBlank?.productTypeId) return;
                            productSyncMutation.mutate(selectedBlank.productTypeId, {
                              onSuccess: () => void refetchCosts(),
                            });
                          }}
                          disabled={productSyncMutation.isPending}
                        >
                          {productSyncMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : null}
                          Refresh costs
                        </Button>
                      </p>
                    )}

                    <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0" style={{maxHeight: '240px'}}>
                      <p className="text-xs font-semibold shimmer-text">
                        Shipping rates vary by destination and are automatically calculated by Shopify once the customer enters their delivery address at checkout — no action needed. To offer free shipping, open <span className="text-primary font-medium">Printify Costs → Shipping</span> to find the rate for your target market and add it to the RRP below.
                      </p>
                      {supportsBothSidePricing && (
                        <p className="text-xs text-muted-foreground">
                          This product can print front-only or front+back. Set both retail prices — the storefront shows
                          “from $front” and charges the front+back price when Print on Back is on.
                        </p>
                      )}
                      {selectedVariants.map((v) => {
                        const frontLabelToCost: Record<string, number> = {};
                        if (costsData?.printifyVariantLabels && costsData.costs) {
                          for (const [printifyVid, label] of Object.entries(costsData.printifyVariantLabels)) {
                            const c = costsData.costs[printifyVid];
                            if (c != null) frontLabelToCost[normalizeVariantLabelForCostMatch(label)] = c;
                          }
                        }
                        const bothLabelToCost: Record<string, number> = {};
                        if (supportsBothSidePricing && costsData?.printifyVariantLabels && costsData.costsBoth) {
                          for (const [printifyVid, label] of Object.entries(costsData.printifyVariantLabels)) {
                            const c = costsData.costsBoth[printifyVid];
                            if (c != null) bothLabelToCost[normalizeVariantLabelForCostMatch(label)] = c;
                          }
                        }
                        const frontCogs = costsData
                          ? resolveBlankVariantCostCents(v, costsData, frontLabelToCost)
                          : undefined;
                        const bothCogs =
                          supportsBothSidePricing && costsData
                            ? resolveBlankVariantCostCents(
                                v,
                                { ...costsData, costs: costsData.costsBoth || {} },
                                bothLabelToCost,
                              )
                            : undefined;
                        const retailN = parseFloat(variantPrices[v.id] || "");
                        const frontProfit =
                          Number.isFinite(retailN) && frontCogs != null
                            ? retailN - frontCogs / 100
                            : null;

                        return (
                        <div key={v.id} className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{v.title}</Label>
                          <div className={supportsBothSidePricing ? "grid grid-cols-2 gap-2" : undefined}>
                            <div className="space-y-1">
                              <div className="flex justify-between items-end gap-2">
                                <span className="text-[10px] text-muted-foreground">
                                  {supportsBothSidePricing ? "Front only" : "Retail"}
                                </span>
                                {costsLoading ? (
                                  <div className="flex items-center gap-1">
                                    <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                  </div>
                                ) : recommendedPrices[v.id] ? (
                                  <span className="text-[10px] text-muted-foreground">Suggested: ${recommendedPrices[v.id]}</span>
                                ) : null}
                              </div>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                                <Input
                                  className={`pl-7 ${priceErrors[v.id] ? "border-destructive" : ""}`}
                                  placeholder="0.00"
                                  value={variantPrices[v.id] ?? ""}
                                  onChange={(e) => setVariantPrices({ ...variantPrices, [v.id]: e.target.value })}
                                />
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                {frontCogs != null
                                  ? `COGS $${(frontCogs / 100).toFixed(2)}${
                                      frontProfit != null
                                        ? ` · Profit $${frontProfit.toFixed(2)}`
                                        : ""
                                    }`
                                  : costsAvailable
                                    ? "COGS unavailable for this variant"
                                    : "COGS loading…"}
                              </p>
                            </div>
                            {supportsBothSidePricing && (
                              <div className="space-y-1">
                                <div className="flex justify-between items-end gap-2">
                                  <span className="text-[10px] text-muted-foreground">Front + back</span>
                                  {recommendedPricesBoth[v.id] ? (
                                    <span className="text-[10px] text-muted-foreground">Suggested: ${recommendedPricesBoth[v.id]}</span>
                                  ) : null}
                                </div>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                                  <Input
                                    className={`pl-7 ${priceErrors[v.id] ? "border-destructive" : ""}`}
                                    placeholder="0.00"
                                    value={variantPricesBoth[v.id] ?? ""}
                                    onChange={(e) => setVariantPricesBoth({ ...variantPricesBoth, [v.id]: e.target.value })}
                                  />
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                  {bothCogs != null
                                    ? `COGS $${(bothCogs / 100).toFixed(2)}${(() => {
                                        const bothRetail = parseFloat(variantPricesBoth[v.id] || "");
                                        if (!Number.isFinite(bothRetail)) return "";
                                        return ` · Profit $${(bothRetail - bothCogs / 100).toFixed(2)}`;
                                      })()}`
                                    : "Front+back COGS pending — open Printify Costs or Retry"}
                                </p>
                              </div>
                            )}
                          </div>
                          {priceErrors[v.id] && (
                            <p className="text-[10px] text-destructive font-medium">{priceErrors[v.id]}</p>
                          )}
                        </div>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 pt-2 shrink-0">
                      <Button variant="outline" className="flex-1" onClick={() => setFormStep(3)}>
                        Back
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={advanceToStep4}
                        disabled={selectedBlankFullyOos || !costsAvailable || costsError}
                        title={
                          selectedBlankFullyOos
                            ? "Cannot create a customizer page while this Printify supplier has no stock"
                            : !costsAvailable || costsError
                              ? "Suggested prices from Printify are required before creating this page"
                              : undefined
                        }
                      >
                        Review & Create <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                    </>
                    )}
                  </div>
                )}

                {/* ── STEP 5: Confirm ── */}
                {formStep === 5 && (
                  <div className="flex flex-col min-h-0 flex-1 pt-2">
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Page title</span>
                        <span className="font-medium">{formTitle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">URL</span>
                        <span className="font-mono">/pages/{formHandle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Product</span>
                        <span className="font-medium">{selectedBlank?.title ?? formProductId}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Print provider</span>
                        <span className="font-medium">{wizardProviderLabel ?? "—"}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground shrink-0">Art styles</span>
                        <span className="font-medium text-right">
                          {formatStyleConfigSummary(formStyleConfig, adminStyles)}
                        </span>
                      </div>
                      {selectedVariants.length > 0 ? (
                        <div className="border-t pt-2 mt-1 space-y-1">
                          <span className="text-muted-foreground text-xs uppercase tracking-wide">Variant prices</span>
                          <div className={selectedVariants.length > 6 ? "max-h-[160px] overflow-y-auto pr-1 space-y-1" : "space-y-1"}>
                            {selectedVariants.map((v) => (
                              <div key={v.id} className="flex justify-between gap-3">
                                <span className="truncate">{v.title}</span>
                                <span className="font-medium shrink-0 text-right">
                                  ${parseFloat(variantPrices[v.id] ?? "0").toFixed(2)}
                                  {supportsBothSidePricing && variantPricesBoth[v.id]
                                    ? ` / $${parseFloat(variantPricesBoth[v.id]).toFixed(2)} both`
                                    : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                          {selectedVariants.length > 6 && (
                            <p className="text-[10px] text-muted-foreground pt-1">{selectedVariants.length} variants total — scroll to view all</p>
                          )}
                        </div>
                      ) : (
                        <div className="border-t pt-2 mt-1">
                          <p className="text-xs text-muted-foreground">Pricing will be set automatically based on your product configuration.</p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This will create the customizer page on your Online Store.
                    </p>
                    </div>
                    <div className="flex gap-2 shrink-0 pt-2">
                      <Button variant="outline" className="flex-1" onClick={() => setFormStep(4)} disabled={createMutation.isPending}>
                        Back
                      </Button>
                      <Button className="flex-1" onClick={handleSubmitCreate} disabled={createMutation.isPending}>
                        {createMutation.isPending ? (
                          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</>
                        ) : (
                          <><Wand2 className="h-4 w-4 mr-2" /> Create Page</>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── STEP 6: Success ── */}
                {formStep === 6 && createdPageResult && (
                  <div className="space-y-6 py-4 text-center">
                    <div className="flex flex-col items-center space-y-2">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <CheckCircle2 className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold">Customizer Page Created!</h3>
                      <p className="text-sm text-muted-foreground">
                        Your page is now live on your storefront.
                      </p>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Storefront URL</span>
                        <a
                          href={`https://${shopDomain}/pages/${createdPageResult.page.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary flex items-center hover:underline"
                        >
                          View Page <ExternalLink className="h-3 w-3 ml-1" />
                        </a>
                      </div>
                      <div className="p-2 bg-background rounded border font-mono text-xs break-all">
                        https://{shopDomain}/pages/{createdPageResult.page.handle}
                      </div>
                      {createdPageResult.navWarning ? (
                        <div className="flex items-start gap-2 pt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <div className="space-y-1">
                            {createdPageResult.navWarning.includes("Navigation scope missing") ? (
                              <>
                                <span className="font-semibold">App needs to be reinstalled to manage navigation.</span>
                                <span className="block">The app is missing the <code>read_online_store_navigation</code> permission. Click below to reinstall — it only takes a moment.</span>
                                <button
                                  className="mt-1 underline font-semibold text-amber-800"
                                  onClick={async () => {
                                    try {
                                      const res = await fetch(`/shopify/reinstall-url?shop=${encodeURIComponent(shopDomain)}`);
                                      const data = await res.json();
                                      window.open(data.url || `/shopify/install?shop=${encodeURIComponent(shopDomain)}`, "_top");
                                    } catch {
                                      window.open(`/shopify/install?shop=${encodeURIComponent(shopDomain)}`, "_top");
                                    }
                                  }}
                                >
                                  Reinstall App →
                                </button>
                              </>
                            ) : (
                              <span>Navigation menu could not be updated automatically. Please add the page link manually in your Shopify admin under <strong>Online Store → Navigation</strong>.</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 pt-1 text-xs text-green-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Added to your store navigation menu automatically.</span>
                        </div>
                      )}
                    </div>

                    <Button className="w-full" onClick={() => { setCreateOpen(false); resetForm(); }}>
                      Done
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>

        {!printifyConnected && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
            <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">Connect Printify to go Live</p>
                <p className="text-sm text-muted-foreground">
                  Preview pages are for you only. Add your Printify API token in Settings before
                  customers can see a Live page and orders can be fulfilled.
                </p>
              </div>
              <Button onClick={() => navigate("/admin/settings")} data-testid="button-connect-printify-banner">
                <Factory className="h-4 w-4 mr-2" />
                Connect Printify
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Reauth Banner */}
        {reauthData && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-800">Shopify connection needs to be refreshed</h3>
              <p className="text-sm text-yellow-700 mt-1">
                Your app's Shopify access token has expired or been revoked. Click below to reconnect
                your store — this only takes a moment.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 border-yellow-300 text-yellow-800 hover:bg-yellow-100"
                onClick={() => window.open(reauthData.reinstallUrl, "_top")}
              >
                Reconnect Shopify
              </Button>
            </div>
          </div>
        )}

        {/* Main Content */}
        {pagesLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* ── UPGRADE PROMPT (if over limit) ── */}
            {overLimit && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <TrendingUp className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-amber-900">Unlock more customizer pages</h3>
                      <p className="text-sm text-amber-800 mt-1">
                        You've reached the limit of <strong>{limit} active pages</strong> on your current plan.
                        Upgrade to activate more pages and grow your custom product catalog.
                      </p>
                      <Button
                        size="sm"
                        className="mt-3 border-amber-600 text-amber-700"
                        onClick={() => navigate("/admin/plan")}
                      >
                        <TrendingUp className="h-3 w-3 mr-1.5" />
                        Upgrade Plan
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── PLAN USAGE BAR ── */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    Plan:
                    <Badge variant="secondary" className="capitalize">
                      {planName ? (PLAN_DISPLAY[planName] ?? planName) : "—"}
                    </Badge>
                    {planStatus === "trialing" && (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-400">Trial</Badge>
                    )}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {count} / {limit} page{limit !== 1 ? "s" : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => navigate("/admin/plan")}
                    >
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                      {planStatus === "trialing" ? "Upgrade" : "Manage Plan"}
                    </Button>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${overLimit ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: limit > 0 ? `${Math.min((count / limit) * 100, 100)}%` : "0%" }}
                  />
                </div>
                {count >= limit && limit > 0 && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Active page limit reached ({limit}). Deactivate a page or upgrade to activate more.
                  </p>
                )}
              </CardContent>
            </Card>

            <GenerationQuotaUsage onUpgradeClick={() => navigate("/admin/plan")} />

            {/* ── PAGES LIST ── */}
            {pages.length > 0 && (
              <CatalogFilterBar
                search={listSearch}
                onSearchChange={setListSearch}
                category={listCategory}
                onCategoryChange={setListCategory}
                showShippingFilters={false}
                showStatusFilter
                statusFilter={listStatus}
                onStatusFilterChange={setListStatus}
                resultCount={filteredPages.length}
                totalCount={pages.length}
                searchPlaceholder="Search pages..."
              />
            )}
            {pagesLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
              </div>
            ) : pages.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                  <p className="font-medium text-lg">No customizer pages yet</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-6">
                    Create your first page to let customers design custom products on your storefront.
                  </p>
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create first page
                  </Button>
                </CardContent>
              </Card>
            ) : filteredPages.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No pages match these filters.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredPages.map((page) => {
                  const blank = blanksData?.blanks.find((b) => b.productTypeId === page.productTypeId);
                  const oosStatus = blank?.oosStatus;
                  const oosBadgeLabel =
                    oosStatus === "fully_oos"
                      ? "Out of stock"
                      : oosStatus === "critical"
                        ? "Low stock"
                        : oosStatus === "error"
                          ? "Stock check failed"
                          : null;
                  const providerLabel =
                    blank?.printifyProviderName ||
                    (blank?.printifyProviderId != null ? `Provider #${blank.printifyProviderId}` : null);
                  const oosTooltip = [
                    providerLabel ? `Printify: ${providerLabel}` : null,
                    blank?.lastOosScanAt
                      ? `${blank.oosAvailableVariants ?? 0}/${blank.oosTotalVariants ?? 0} variants available (checked ${new Date(blank.lastOosScanAt).toLocaleString()})`
                      : "Stock not scanned yet",
                  ]
                    .filter(Boolean)
                    .join(" — ");
                  return (
                  <Card key={page.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{page.title}</span>
                            <Badge
                              variant={
                                page.status === "active"
                                  ? "default"
                                  : page.status === "preview"
                                    ? "outline"
                                    : "secondary"
                              }
                            >
                              {statusBadgeLabel(page.status)}
                            </Badge>
                            {oosBadgeLabel && (
                              <Badge
                                variant="destructive"
                                title={oosTooltip}
                                className="flex items-center gap-1"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {oosBadgeLabel}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5 font-mono">
                            /pages/{page.handle}
                          </p>
                          {page.baseProductTitle && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {page.baseProductTitle}
                              {page.baseVariantTitle && ` — ${page.baseVariantTitle}`}
                              {page.baseProductPrice && ` · $${parseFloat(page.baseProductPrice).toFixed(2)}`}
                            </p>
                          )}
                          {providerLabel && (
                            <p className="text-xs text-muted-foreground mt-1" title={oosTooltip}>
                              Printify: {providerLabel}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Styles: {formatStyleConfigSummary(
                              parseCustomizerPageStyleConfig(page.styleConfig),
                              adminStyles,
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button variant="ghost" size="icon" asChild title="Open storefront page">
                            <a
                              href={`https://${page.shop}/pages/${page.handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={toggleMutation.isPending}
                            title={
                              page.status === "active"
                                ? "Disable page"
                                : page.status === "preview"
                                  ? "Set Live"
                                  : "Set Live"
                            }
                            onClick={() => {
                              const nextStatus = page.status === "active" ? "disabled" : "active";
                              if (nextStatus === "active" && parseFloat(page.baseProductPrice || "0") <= 0) {
                                toast({
                                  title: "Set prices via Resync Prices before going Live",
                                  description: `"${page.title}" doesn't have a retail price yet.`,
                                  variant: "destructive",
                                });
                                return;
                              }
                              toggleMutation.mutate({ id: page.id, status: nextStatus });
                            }}
                          >
                            {page.status === "active" ? (
                              <ToggleRight className="h-4 w-4 text-primary" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit page settings"
                            onClick={() => setEditTarget(page)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Resync prices to Shopify"
                            onClick={() => setSyncPricesTarget(page)}
                          >
                            <DollarSign className="h-4 w-4" />
                          </Button>
                          {page.productTypeId != null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={`Scan Printify stock now — ${oosTooltip}`}
                              disabled={scanStockMutation.isPending}
                              onClick={() => scanStockMutation.mutate(page.productTypeId as number)}
                            >
                              <RefreshCw className={`h-4 w-4 ${scanStockMutation.isPending && scanStockMutation.variables === page.productTypeId ? "animate-spin" : ""}`} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete page"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(page)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            )}

            {/* ── FALLBACK URL ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Disabled Page Fallback</CardTitle>
                <CardDescription>Where to redirect visitors if a customizer page is disabled.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="/collections/custom-products"
                    value={hubUrl}
                    onChange={(e) => setHubUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={() => hubUrlMutation.mutate(hubUrl)}
                    disabled={hubUrlMutation.isPending}
                  >
                    {hubUrlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Use a relative path (e.g. <code className="bg-muted px-1 rounded">/collections/all</code>) or full URL.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Edit customizer page dialog */}
      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5" />
              Edit Customizer — {editTarget?.title}
            </DialogTitle>
          </DialogHeader>
          {blanksLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !editBlank ? (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              Product settings could not be loaded for this page.
            </p>
          ) : (
            <div className="space-y-5 pt-2">
              <div className="space-y-2">
                <Label htmlFor="edit-description">Product Description</Label>
                <Textarea
                  id="edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={5}
                  placeholder="Describe this custom product..."
                />
                <p className="text-xs text-muted-foreground">
                  Saved locally and synced to the linked Shopify product description.
                </p>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Pricing strategy</p>
                <div className="space-y-2">
                  <Label>When supplier costs change</Label>
                  <Select value={editPricingStrategy} onValueChange={setEditPricingStrategy}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notify_only">Notify only</SelectItem>
                      <SelectItem value="maintain_margin">Maintain margin (auto Resync)</SelectItem>
                      <SelectItem value="maintain_price">Maintain retail price</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-markup">Markup %</Label>
                    <Input
                      id="edit-markup"
                      type="number"
                      min={0}
                      value={editMarkupPercent}
                      onChange={(e) => setEditMarkupPercent(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-min-margin">Min margin %</Label>
                    <Input
                      id="edit-min-margin"
                      type="number"
                      min={0}
                      max={99}
                      placeholder="optional"
                      value={editMinMarginPercent}
                      onChange={(e) => setEditMinMarginPercent(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <Label>Print provider</Label>
                <p className="text-sm font-medium">
                  {editBlank.printifyProviderName ||
                    (editBlank.printifyProviderId != null
                      ? `Provider #${editBlank.printifyProviderId}`
                      : "Not set")}
                </p>
                <p className="text-xs text-muted-foreground">
                  To switch suppliers, create a new Customizer Page for this product and pick a different
                  Printify provider (variants and costs are provider-specific).
                </p>
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label>Variants (sizes &amp; colours)</Label>
                  <div className="flex items-center gap-2">
                    {editVariantOverLimit && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={editVariantsLoading}
                        onClick={() => {
                          const trimmed = trimSelectionToShopifyMax(
                            Array.from(editSizeIds),
                            Array.from(editColorIds),
                          );
                          setEditSizeIds(new Set(trimmed.sizeIds));
                          setEditColorIds(new Set(trimmed.colorIds));
                          toast({
                            title: "Trimmed to Shopify limit",
                            description: `Kept ${trimmed.count} variants (all sizes where possible, fewer colours). Save to apply.`,
                          });
                        }}
                      >
                        Auto-trim to {SHOPIFY_MAX_VARIANTS_PER_PRODUCT}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        editVariantsMutation.isPending ||
                        editVariantsLoading ||
                        editVariantOverLimit
                      }
                      onClick={() => editVariantsMutation.mutate()}
                    >
                      {editVariantsMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : null}
                      Save variants
                    </Button>
                  </div>
                </div>
                {editVariantsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading variant options…
                  </div>
                ) : (
                  <>
                    <p
                      className={`text-xs font-medium ${
                        editVariantOverLimit ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      Selected: {editVariantCount} / {SHOPIFY_MAX_VARIANTS_PER_PRODUCT} max
                      {editVariantOverLimit
                        ? " — over Shopify’s limit. Deselect colours or Auto-trim before saving."
                        : ""}
                    </p>
                    {editSizes.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">
                          Sizes ({editSizeIds.size}/{editSizes.length})
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-32 overflow-y-auto border rounded-md p-2">
                          {editSizes.map((size) => (
                            <label key={size.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={editSizeIds.has(size.id)}
                                onCheckedChange={() => {
                                  setEditSizeIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(size.id)) next.delete(size.id);
                                    else next.add(size.id);
                                    return next;
                                  });
                                }}
                              />
                              {size.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {editColors.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">
                          Colours ({editColorIds.size}/{editColors.length})
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto border rounded-md p-2">
                          {editColors.map((color) => (
                            <label
                              key={color.id}
                              className="flex items-center gap-2 text-sm cursor-pointer p-1 hover:bg-muted rounded"
                            >
                              <Checkbox
                                checked={editColorIds.has(color.id)}
                                onCheckedChange={() => {
                                  setEditColorIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(color.id)) next.delete(color.id);
                                    else next.add(color.id);
                                    return next;
                                  });
                                }}
                              />
                              <span
                                className="w-4 h-4 rounded-full border border-border flex-shrink-0 flex items-center justify-center text-[8px] text-muted-foreground"
                                style={
                                  color.hex
                                    ? { backgroundColor: color.hex }
                                    : { backgroundColor: "var(--muted)" }
                                }
                                title={color.hex || "No swatch"}
                              >
                                {!color.hex && color.name?.charAt(0).toUpperCase()}
                              </span>
                              <span className="truncate">{color.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-md border p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <div>
                  <Label>Pricing</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Front / front+back retail when Printify supports both print sides. Open Resync Prices to
                    update Shopify.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (editTarget) setSyncPricesTarget(editTarget);
                  }}
                >
                  <DollarSign className="h-3.5 w-3.5 mr-1" />
                  Resync Prices
                </Button>
              </div>

              {editStyleConfig && (
                <CustomizerPageStyleSelector
                  designerType={editBlank.designerType}
                  availableStyles={adminStyles}
                  value={editStyleConfig}
                  onChange={setEditStyleConfig}
                />
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Placeholder Images</Label>
                  <span className="text-xs text-muted-foreground text-right max-w-[22rem]">
                    Choose 1 primary and up to {MAX_GALLERY_PLACEHOLDERS} gallery images.
                    Primary is your marketing hero — on the storefront the selected colour blank
                    leads when available; your Primary stays in the carousel.
                  </span>
                </div>
                {(() => {
                  const available = buildAvailablePlaceholderImages(
                    editBlank.baseMockupImages,
                    editCustomPlaceholder || undefined,
                  );
                  if (available.length === 0) {
                    return (
                      <p className="rounded-md border p-3 text-sm text-muted-foreground">
                        No placeholder images are stored yet. Upload a custom image, or refresh images from the Products admin page.
                      </p>
                    );
                  }
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-md border p-2">
                      {available.map((img, index) => {
                        const isPrimary = editPrimaryPlaceholder === img.url;
                        const isGallery = editGalleryPlaceholders.has(img.url);
                        return (
                          <div key={`${img.url}-${index}`} className={`relative rounded-md border p-2 space-y-2 ${isPrimary ? "ring-2 ring-primary" : ""}`}>
                            {isPrimary && (
                              <span className="absolute right-2 top-2 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow">
                                Current
                              </span>
                            )}
                            <button
                              type="button"
                              className="block w-full overflow-hidden rounded bg-muted"
                              onClick={() => setEditPrimaryPlaceholder(img.url)}
                            >
                              <img src={img.url} alt={img.label} className="h-28 w-full object-cover" />
                            </button>
                            <p className="truncate text-xs font-medium">{img.label}</p>
                            <div className="flex items-center justify-between gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant={isPrimary ? "default" : "outline"}
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditPrimaryPlaceholder(img.url)}
                              >
                                Primary
                              </Button>
                              <label className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  checked={isGallery}
                                  disabled={!isGallery && editGalleryPlaceholders.size >= MAX_GALLERY_PLACEHOLDERS}
                                  onChange={() => toggleEditGalleryPlaceholder(img.url)}
                                />
                                Gallery
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={placeholderUploadRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    className="hidden"
                    onChange={handlePlaceholderUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => placeholderUploadRef.current?.click()}
                    disabled={uploadingPlaceholder}
                  >
                    {uploadingPlaceholder ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    Upload Custom Image
                  </Button>
                  <span className="text-xs text-muted-foreground">PNG, JPG, or WebP</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={() => editMutation.mutate()}
                  disabled={editMutation.isPending || !!editStyleError}
                >
                  {editMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ResyncPricesDialog
        open={!!syncPricesTarget}
        onOpenChange={(v) => { if (!v) setSyncPricesTarget(null); }}
        title={syncPricesTarget?.title ?? ""}
        productTypeId={syncPricesTarget?.productTypeId ?? 0}
        customizerPageId={syncPricesTarget?.id}
      />

      <AlertDialog open={!!placeholderStepAlert} onOpenChange={(v) => !v && setPlaceholderStepAlert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose storefront images</AlertDialogTitle>
            <AlertDialogDescription>
              {placeholderStepAlert || "Choose a primary image and at least one gallery image before continuing."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setPlaceholderStepAlert(null);
                document.getElementById("create-placeholder-images")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              Choose images
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customizer page?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete <strong>{deleteTarget?.title}</strong> (/pages/{deleteTarget?.handle}) from
              both AI Art Studio and your Shopify store. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget?.id && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting…</>
              ) : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
