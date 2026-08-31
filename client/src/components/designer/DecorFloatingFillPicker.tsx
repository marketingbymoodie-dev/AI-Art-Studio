import { useCallback } from "react";
import { Pipette } from "lucide-react";
import { DEFAULT_DECOR_BACKGROUND_FILL } from "@shared/decorBackgroundFill";
import { Label } from "@/components/ui/label";

type FillSwatch = { hex: string };

const FIXED_SWATCHES: FillSwatch[] = [
  { hex: DEFAULT_DECOR_BACKGROUND_FILL },
  { hex: "#000000" },
];

function normalizeHex(raw: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

type DecorFloatingFillPickerProps = {
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  /** Artwork-derived colours (hex). White + black are always appended. */
  swatches?: FillSwatch[];
};

/**
 * Live fill behind floating GPT artwork. Defaults to white; any hex via
 * swatch / field / eyedropper. "None" is a checkerboard swatch (transparent),
 * not a White/None text toggle.
 */
export function DecorFloatingFillPicker({
  value,
  onChange,
  hint,
  swatches = [],
}: DecorFloatingFillPickerProps) {
  const hex = normalizeHex(value) ?? DEFAULT_DECOR_BACKGROUND_FILL;
  const isNone = value === "none";
  const row = [
    ...swatches.filter((s) => normalizeHex(s.hex)),
    ...FIXED_SWATCHES,
  ].filter((s, i, all) => all.findIndex((x) => x.hex.toUpperCase() === s.hex.toUpperCase()) === i);

  const triggerEyedropper = useCallback(async () => {
    const W = window as unknown as {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex?: string }> };
    };
    if (!W.EyeDropper) return;
    try {
      const ed = new W.EyeDropper();
      const r = await ed.open();
      const next = r?.sRGBHex ? normalizeHex(r.sRGBHex) : null;
      if (next) onChange(next);
    } catch {
      /* cancelled */
    }
  }, [onChange]);

  return (
    <div className="mt-2" data-testid="decor-floating-fill-picker">
      <Label className="text-xs">Background</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-card"
          aria-label="Background colour"
        />
        <input
          type="text"
          value={isNone ? "" : hex}
          placeholder="#FFFFFF"
          onChange={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              onChange("none");
              return;
            }
            const n = normalizeHex(v);
            if (n) onChange(n);
          }}
          className="h-8 flex-1 rounded border border-border bg-card px-2 text-xs text-card-foreground"
          spellCheck={false}
          aria-label="Background hex"
        />
        {typeof window !== "undefined" && "EyeDropper" in window && (
          <button
            type="button"
            onClick={() => void triggerEyedropper()}
            className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-card-foreground hover:bg-muted"
            title="Pick a colour from anywhere on screen"
            aria-label="Eyedropper"
          >
            <Pipette className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {row.map((s) => (
          <button
            key={s.hex}
            type="button"
            onClick={() => onChange(s.hex.toUpperCase())}
            title={s.hex}
            aria-label={`Use ${s.hex} as background`}
            className={`h-6 w-6 rounded border-2 transition ${
              !isNone && hex.toUpperCase() === s.hex.toUpperCase()
                ? "border-primary ring-2 ring-primary/40"
                : "border-border hover:border-foreground/40"
            }`}
            style={{ backgroundColor: s.hex }}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange("none")}
          title="None (transparent)"
          aria-label="None (transparent)"
          aria-pressed={isNone}
          data-testid="decor-fill-none"
          className={`h-6 w-6 rounded border-2 transition ${
            isNone
              ? "border-primary ring-2 ring-primary/40"
              : "border-border hover:border-foreground/40"
          }`}
          style={{
            backgroundImage:
              "linear-gradient(45deg, #d1d5db 25%, transparent 25%), linear-gradient(-45deg, #d1d5db 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1d5db 75%), linear-gradient(-45deg, transparent 75%, #d1d5db 75%)",
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
            backgroundColor: "#fff",
          }}
        />
      </div>
      {hint ? (
        <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}
