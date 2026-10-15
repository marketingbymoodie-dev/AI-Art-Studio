import { useEffect, useState, type ReactNode } from "react";
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

type ColourReading = {
  name: string;
  hex: string;
  minClear: number;
  eligible: boolean;
};

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
};

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

  useEffect(() => {
    const list = candidate.data?.sizes;
    if (!list?.length || list.includes(size)) return;
    const preferred = candidate.data?.selectedSize;
    setSize(preferred && list.includes(preferred) ? preferred : list[0]);
  }, [candidate.data, size]);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/platform/catalogue-studio/pending-preview?color=${encodeURIComponent(color)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        if (!cancelled) setPreviewError(await res.text());
        return;
      }
      url = URL.createObjectURL(await res.blob());
      if (!cancelled) {
        setPreviewError(null);
        setPreviewUrl(url);
      }
    })().catch((e) => {
      if (!cancelled) setPreviewError(String(e?.message || e));
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [color]);

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
  const active = candidate.data?.colors.find((c) => c.name === color);
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
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {previewError ? previewError : <Loader2 className="h-5 w-5 animate-spin" />}
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
      <div className={showAdmin ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]" : ""}>
        <div>
          <div className="grid gap-8 md:grid-cols-2">
            <div data-testid="catalogue-studio-hero">
              <div className="mx-auto aspect-square max-w-[520px] overflow-hidden rounded-md bg-white">
                {hero}
              </div>
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
              <div className="flex gap-2">
                {(candidate.data?.colors || []).map((c) => (
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
                <Button type="button" size="sm" onClick={() => { setVerdict("approved"); setDropError(""); }}>
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
