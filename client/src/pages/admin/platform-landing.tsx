import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/admin-layout";
import { apiRequest, apiFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  clampLandingAutoMs,
  clampLandingTypeDelayMs,
  DEFAULT_LANDING_CONTENT,
  LANDING_AUTO_MS_MAX,
  LANDING_AUTO_MS_MIN,
  LANDING_COPY_FIELDS,
  LANDING_GALLERY_AUTO_DEFAULT_MS,
  LANDING_HERO_AUTO_DEFAULT_MS,
  LANDING_TYPE_DELAY_FAST_MS,
  LANDING_TYPE_DELAY_SLOW_MS,
  type LandingCard,
  type LandingContent,
  type LandingCopy,
  type LandingScene,
} from "@shared/landingContent";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = items.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

function AutoScrollSlider({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (ms: number) => void;
}) {
  const seconds = (value / 1000).toFixed(1);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label} <span className="font-normal text-muted-foreground">({seconds}s)</span>
      </Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <input
        id={id}
        type="range"
        min={LANDING_AUTO_MS_MIN}
        max={LANDING_AUTO_MS_MAX}
        step={500}
        value={value}
        onChange={(e) => onChange(clampLandingAutoMs(Number(e.target.value), value))}
        className="w-full accent-foreground"
        aria-label={label}
      />
      <div className="flex justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>2.5s</span>
        <span>20s</span>
      </div>
    </div>
  );
}

function ReorderButtons({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        disabled={index === 0}
        aria-label="Move up"
        onClick={() => onMove(index - 1)}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={index >= count - 1}
        aria-label="Move down"
        onClick={() => onMove(index + 1)}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  );
}

async function uploadFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const res = await apiFetch("/api/uploads/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl, name: file.name }),
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.objectPath as string;
}

export default function PlatformLandingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"text" | "scenes" | "cards">("text");
  const [draft, setDraft] = useState<LandingContent>(DEFAULT_LANDING_CONTENT);

  const { data, isLoading } = useQuery<{ content: LandingContent }>({
    queryKey: ["/api/platform/landing"],
  });

  useEffect(() => {
    if (data?.content) setDraft(data.content);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/platform/landing", { content: draft });
      return res.json() as Promise<{ content: LandingContent }>;
    },
    onSuccess: (body) => {
      setDraft(body.content);
      qc.invalidateQueries({ queryKey: ["/api/platform/landing"] });
      qc.invalidateQueries({ queryKey: ["/api/creators/landing"] });
      toast({ title: "Landing saved", description: "Public /beta and apply pages will use this copy." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const setCopy = (key: keyof LandingCopy, value: string) => {
    setDraft((d) => ({ ...d, copy: { ...d.copy, [key]: value } }));
  };

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Landing page</h1>
            <p className="text-sm text-muted-foreground">
              Edit hero copy, coverflow cards, Product Prompt Gallery slides, and apply-form wording.
              Auto-scroll timers for the hero and gallery are independent.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href="/beta" target="_blank" rel="noreferrer">
                Preview /beta
              </a>
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["text", "Page text"],
              ["scenes", "Prompt gallery"],
              ["cards", "Info cards"],
            ] as const
          ).map(([id, label]) => (
            <Button key={id} variant={tab === id ? "default" : "outline"} size="sm" onClick={() => setTab(id)}>
              {label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tab === "text" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2 max-w-md">
              <Label htmlFor="typeDelayMs">Prompt type speed</Label>
              <p className="text-xs text-muted-foreground">
                How fast the Product Prompt Gallery types each prompt. Fast is the original speed;
                the default is half that.
              </p>
              <input
                id="typeDelayMs"
                type="range"
                min={LANDING_TYPE_DELAY_FAST_MS}
                max={LANDING_TYPE_DELAY_SLOW_MS}
                step={2}
                value={clampLandingTypeDelayMs(draft.typeDelayMs)}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    typeDelayMs: clampLandingTypeDelayMs(Number(e.target.value)),
                  }))
                }
                className="w-full accent-foreground"
                aria-label="Prompt type speed"
              />
              <div className="flex justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>Fast</span>
                <span>Slow</span>
              </div>
            </div>
            <AutoScrollSlider
              id="heroAutoMs"
              label="Hero cards auto-scroll"
              hint="How long each info card stays on the first page before advancing. Pauses while the visitor hovers."
              value={clampLandingAutoMs(draft.heroAutoMs, LANDING_HERO_AUTO_DEFAULT_MS)}
              onChange={(heroAutoMs) => setDraft((d) => ({ ...d, heroAutoMs }))}
            />
            <AutoScrollSlider
              id="galleryAutoMs"
              label="Prompt gallery auto-scroll"
              hint="How long each gallery card stays before advancing. Independent of the hero timer. Pauses on hover."
              value={clampLandingAutoMs(draft.galleryAutoMs, LANDING_GALLERY_AUTO_DEFAULT_MS)}
              onChange={(galleryAutoMs) => setDraft((d) => ({ ...d, galleryAutoMs }))}
            />
            {LANDING_COPY_FIELDS.map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>
                {/headline|lede|terms|body|line|intro|window/i.test(label) || draft.copy[key].length > 48 ? (
                  <Textarea
                    id={key}
                    rows={3}
                    value={draft.copy[key]}
                    onChange={(e) => setCopy(key, e.target.value)}
                  />
                ) : (
                  <Input id={key} value={draft.copy[key]} onChange={(e) => setCopy(key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        ) : tab === "scenes" ? (
          <MediaList
            items={draft.scenes}
            promptLabel="Typed prompt"
            onChange={(scenes) => setDraft((d) => ({ ...d, scenes }))}
            onAdd={() =>
              setDraft((d) => ({
                ...d,
                scenes: [...d.scenes, { id: `s${Date.now()}`, prompt: "Describe the design…", imageUrl: "" }],
              }))
            }
          />
        ) : (
          <CardList
            items={draft.cards}
            onChange={(cards) => setDraft((d) => ({ ...d, cards }))}
            onAdd={() =>
              setDraft((d) => ({
                ...d,
                cards: [...d.cards, { id: `c${Date.now()}`, title: "New card", body: "", imageUrl: "" }],
              }))
            }
          />
        )}
      </div>
    </AdminLayout>
  );
}

function MediaList({
  items,
  promptLabel,
  onChange,
  onAdd,
}: {
  items: LandingScene[];
  promptLabel: string;
  onChange: (next: LandingScene[]) => void;
  onAdd: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item, i) => (
        <article key={item.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Slide {i + 1}</h3>
            <div className="flex items-center">
              <ReorderButtons
                index={i}
                count={items.length}
                onMove={(to) => onChange(moveItem(items, i, to))}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={items.length < 2}
                aria-label="Delete slide"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" className="h-36 w-full rounded-md object-cover" />
          ) : (
            <div className="flex h-36 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
              No mockup yet
            </div>
          )}
          <div className="space-y-2">
            <Label>{promptLabel}</Label>
            <Textarea
              rows={3}
              value={item.prompt}
              onChange={(e) =>
                onChange(items.map((row, idx) => (idx === i ? { ...row, prompt: e.target.value } : row)))
              }
            />
          </div>
          <ImageField
            onUploaded={(url) =>
              onChange(items.map((row, idx) => (idx === i ? { ...row, imageUrl: url } : row)))
            }
          />
        </article>
      ))}
      <Button variant="outline" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        Add gallery slide
      </Button>
    </div>
  );
}

function CardList({
  items,
  onChange,
  onAdd,
}: {
  items: LandingCard[];
  onChange: (next: LandingCard[]) => void;
  onAdd: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item, i) => (
        <article key={item.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Card {i + 1}</h3>
            <div className="flex items-center">
              <ReorderButtons
                index={i}
                count={items.length}
                onMove={(to) => onChange(moveItem(items, i, to))}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={items.length < 2}
                aria-label="Delete card"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" className="h-36 w-full rounded-md object-cover" />
          ) : (
            <div className="flex h-36 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
              No image yet
            </div>
          )}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={item.title}
              onChange={(e) =>
                onChange(items.map((row, idx) => (idx === i ? { ...row, title: e.target.value } : row)))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Body</Label>
            <Textarea
              rows={3}
              value={item.body}
              onChange={(e) =>
                onChange(items.map((row, idx) => (idx === i ? { ...row, body: e.target.value } : row)))
              }
            />
          </div>
          <ImageField
            onUploaded={(url) =>
              onChange(items.map((row, idx) => (idx === i ? { ...row, imageUrl: url } : row)))
            }
          />
        </article>
      ))}
      <Button variant="outline" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        Add info card
      </Button>
    </div>
  );
}

function ImageField({ onUploaded }: { onUploaded: (url: string) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onUploaded(await uploadFile(file));
          } catch (err: any) {
            toast({ title: "Upload failed", description: err.message, variant: "destructive" });
          } finally {
            setBusy(false);
          }
        }}
      />
      <span className="rounded-md border px-3 py-1.5">
        {busy ? "Uploading…" : "Upload product mockup"}
      </span>
    </Label>
  );
}
