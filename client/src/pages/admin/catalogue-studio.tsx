import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PETPOSTEROUS_CONCEPT_FRAMEWORKS } from "@shared/petposterousCreative";
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

type ColourReading = {
  name: string;
  hex: string;
  minClear: number;
  eligible: boolean;
};

type SceneColour = { id: string; name: string; hex: string; kind: "produced" | "white-master" };
type SceneGroup = { panelId: string; label: string; isDefault: boolean; colours: SceneColour[] };
type TickedColour = { name: string; hex: string };

type PendingCandidate = {
  id: string;
  status: "pending";
  title: string;
  shopifyProductId: null;
  sizes: string[];
  pricesBySize: Record<string, string>;
  colors: Array<{ name: string; hex: string }>;
  selectedColor: string;
  selectedSize: string;
  eligibility: ColourReading[] | null;
  scenes: SceneGroup[];
  choice: { panelId: string | null; selectedColors: TickedColour[]; artworkPath: string | null };
  recentScenes: string[];
  productTypeId: number;
  productTypeName: string;
};

function sceneColours(scene: SceneGroup | undefined, fallback: Array<{ name: string; hex: string }>) {
  if (!scene) return [] as Array<{ name: string; hex: string; path: "produced" | "recolour" }>;
  const rows = scene.colours.map((c) => ({ name: c.name, hex: c.hex, path: "produced" as const }));
  if (scene.colours.some((c) => c.kind === "white-master")) {
    for (const color of fallback) {
      if (!rows.some((row) => row.name.toLowerCase() === color.name.toLowerCase())) {
        rows.push({ name: color.name, hex: color.hex, path: "recolour" });
      }
    }
  }
  return rows;
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

type Override = "rule" | "eligible" | "ineligible";

function Field({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <label className="block space-y-1" id={id}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}

export default function CatalogueStudioPage() {
  const candidate = useQuery<PendingCandidate>({
    queryKey: ["/api/platform/catalogue-studio/pending"],
  });
  const panels = useQuery<{ scenes: SceneGroup[] }>({
    queryKey: ["/api/platform/catalogue-studio/panels"],
  });
  const [size, setSize] = useState("L");
  const [color, setColor] = useState("White");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(true);

  const [behaviour, setBehaviour] = useState("");
  const [truth, setTruth] = useState("");
  const [wording, setWording] = useState("Bed Etiquette");
  const [device, setDevice] = useState("");
  const [deviceStructure, setDeviceStructure] = useState("");
  const [humour, setHumour] = useState("");
  const [darkness, setDarkness] = useState("");
  const [species, setSpecies] = useState("");
  const [styleId, setStyleId] = useState("");
  const [surface, setSurface] = useState("apparel");

  const [drawCount, setDrawCount] = useState(1);
  const [draw, setDraw] = useState(1);
  const [verdict, setVerdict] = useState<"pending" | "approved" | "dropped">("pending");
  const [dropReason, setDropReason] = useState("");
  const [dropError, setDropError] = useState("");
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
    const scenes = candidate.data?.scenes;
    if (!scenes?.length || panelId) return;
    const stored = candidate.data?.choice.panelId;
    const next = stored && scenes.some((scene) => scene.panelId === stored)
      ? stored
      : scenes.find((scene) => scene.isDefault)?.panelId || scenes[0].panelId;
    const colours = candidate.data?.choice.selectedColors ?? [];
    setPanelId(next);
    setTicked(colours);
    if (!stored) {
      void fetch("/api/platform/catalogue-studio/choice", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelId: next, selectedColors: colours }),
      });
    }
  }, [candidate.data, panelId]);

  useEffect(() => {
    if (!panelId) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/platform/catalogue-studio/pending-preview?color=${encodeURIComponent(color)}&panelId=${encodeURIComponent(panelId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        if (!cancelled) {
          setCellSource("");
          setPreviewError(await res.text());
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
      if (!cancelled) setPreviewError(String(e?.message || e));
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [color, panelId, previewNonce]);

  useEffect(() => {
    if (!showAdmin) return;
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setDraw((current) => {
        const count = Math.max(1, drawCount);
        const next = event.key === "ArrowRight" ? current + 1 : current - 1;
        if (next < 1) return count;
        if (next > count) return 1;
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdmin, drawCount]);

  const sizes = candidate.data?.sizes ?? [];
  const price = candidate.data?.pricesBySize?.[size] ? `$${candidate.data.pricesBySize[size]}` : "";
  const scene = candidate.data?.scenes.find((row) => row.panelId === panelId);
  const offered = sceneColours(scene, candidate.data?.colors ?? []);
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

  return (
    <AdminLayout>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Pending candidate. No Shopify product.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdmin((v) => !v)}>
          {showAdmin ? "Simulate customer" : "Show operator panel"}
        </Button>
      </div>
      <div className="mb-6 rounded-md border p-4" data-testid="catalogue-studio-panels">
        <MockupBulkImport
          productType={candidate.data ? { id: candidate.data.productTypeId, name: candidate.data.productTypeName } : null}
          storedScenes={(panels.data?.scenes ?? []).map((scene) => scene.panelId)}
          onImported={() => Promise.all([candidate.refetch(), panels.refetch()])}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Panels on file: {panels.data ? panels.data.scenes.length : "…"}
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
                      body: JSON.stringify({ panelId, color, size }),
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
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {sizes.map((s) => (
                    <Button key={s} type="button" size="sm" variant={size === s ? "default" : "outline"} onClick={() => setSize(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
                <a href="#size-guide" className="text-sm underline">Size Guide</a>
              </div>
              <p className="text-sm">{active?.name || color}</p>
              {cellSource ? (
                <p className="text-sm" data-testid="catalogue-studio-cell-source">{cellSource}</p>
              ) : null}
              <div className="flex gap-2">
                {(offered.length ? offered : candidate.data?.colors || []).map((c) => (
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
              <p className="text-lg" data-testid="catalogue-studio-price">{price}</p>
              <p className="text-sm text-muted-foreground">Shipping calculated at checkout</p>
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
            <p className="text-sm text-muted-foreground">No other pending candidates on this garment.</p>
          </section>
        </div>
        {showAdmin ? (
          <aside className="max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto rounded-md border p-4 text-sm xl:sticky xl:top-4">
            <div>
              <p className="font-medium">Candidate {candidate.data?.id || "pending-bed-etiquette"}</p>
              <p>Status: {verdict}</p>
            </div>

            <section className="space-y-2">
              <h2 className="font-medium">Recipe</h2>
              <Field label="Behaviour" id="studio-recipe-behaviour">
                <Textarea value={behaviour} onChange={(e) => setBehaviour(e.target.value)} placeholder="Not written" />
              </Field>
              <Field label="Truth">
                <Textarea value={truth} onChange={(e) => setTruth(e.target.value)} placeholder="Not written" />
              </Field>
              <Field label="Exact wording">
                <Input value={wording} onChange={(e) => setWording(e.target.value)} />
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
              <Button type="button" size="sm" variant="outline" disabled>Re-render</Button>
              <p className="text-xs text-muted-foreground">Generation is not connected. Editing stays on this page.</p>
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
                  const available = sceneColours(nextScene, candidate.data?.colors ?? []);
                  const kept = ticked.filter((tick) => available.some((row) => row.name === tick.name));
                  setPanelId(next);
                  setTicked(kept);
                  setColor((current) => (available.some((row) => row.name === current) ? current : available[0]?.name || current));
                  void fetch("/api/platform/catalogue-studio/choice", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ panelId: next, selectedColors: kept }),
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
                            checked={on}
                            onChange={() => {
                              const next = on
                                ? ticked.filter((tick) => tick.name !== row.name)
                                : [...ticked, { name: row.name, hex: row.hex }];
                              setTicked(next);
                              void fetch("/api/platform/catalogue-studio/choice", {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ panelId, selectedColors: next }),
                              });
                            }}
                          />
                          {row.name}
                          {reading ? ` ${(reading.minClear * 100).toFixed(1)}% ${reading.eligible ? "pass" : "fail"}` : ""}
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
                      body: JSON.stringify({ imageBase64 }),
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
                Weakest region. Share of its pixels with dE2000 over 32. Legible at 15% or more. Display only.
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
              <Field label="Draw count">
                <Input
                  type="number"
                  min={1}
                  value={drawCount}
                  onChange={(e) => {
                    const next = Math.max(1, Number(e.target.value) || 1);
                    setDrawCount(next);
                    setDraw((current) => Math.min(current, next));
                  }}
                />
              </Field>
              <p>Selected draw {draw} of {Math.max(1, drawCount)}. Arrow keys switch while this panel is open.</p>
              {draw === 1 ? (
                <p className="text-xs text-muted-foreground">Draw 1 is the pending artwork on the hero.</p>
              ) : (
                <p className="text-xs text-muted-foreground">Draw {draw} has no render. The hero is still draw 1.</p>
              )}
              <Button type="button" size="sm" variant="outline" disabled>Regenerate</Button>
            </section>

            <section className="space-y-2">
              <h2 className="font-medium">Verdict</h2>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={async () => {
                  const res = await fetch("/api/platform/catalogue-studio/approve", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ panelId, selectedColors: ticked }),
                  });
                  const body = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    setDropError(body.error || "Approval stopped");
                    return;
                  }
                  setDropError("");
                  setVerdict("approved");
                  await candidate.refetch();
                }}>
                  Approve
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => document.querySelector<HTMLTextAreaElement>("#studio-recipe-behaviour textarea")?.focus()}>
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!dropReason.trim()) {
                      setDropError("Write a reason.");
                      return;
                    }
                    setDropError("");
                    setVerdict("dropped");
                  }}
                >
                  Drop
                </Button>
              </div>
              <Textarea value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="Drop reason" />
              {dropError ? <p className="text-xs">{dropError}</p> : null}
              {verdict === "dropped" ? <p>Dropped: {dropReason}</p> : null}
              {verdict === "approved" ? <p>Approved on this page. No Shopify product was created.</p> : null}
              <p className="text-xs text-muted-foreground">Promote is the only step that creates a Shopify product. This page does not.</p>
            </section>

            <section>
              <h2 className="font-medium">Costs</h2>
              <p>Per render: none recorded</p>
              <p>Cumulative: none recorded</p>
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
