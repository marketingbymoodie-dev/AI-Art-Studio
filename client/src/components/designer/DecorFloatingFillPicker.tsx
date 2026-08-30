import { DEFAULT_DECOR_BACKGROUND_FILL } from "@shared/decorBackgroundFill";
import { Label } from "@/components/ui/label";

type DecorFloatingFillPickerProps = {
  value: string;
  onChange: (next: string) => void;
  hint?: string;
};

/** Live fill: White / None / colour. Recolors instantly — no generate. */
export function DecorFloatingFillPicker({
  value,
  onChange,
  hint,
}: DecorFloatingFillPickerProps) {
  const hex =
    value !== "none" && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value
      : DEFAULT_DECOR_BACKGROUND_FILL;
  return (
    <div className="mt-2" data-testid="decor-minimalist-background">
      <Label className="text-xs">Background</Label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_DECOR_BACKGROUND_FILL)}
          className={`rounded border px-2 py-1 text-[10px] font-semibold transition ${
            value === DEFAULT_DECOR_BACKGROUND_FILL
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          White
        </button>
        <button
          type="button"
          onClick={() => onChange("none")}
          className={`rounded border px-2 py-1 text-[10px] font-semibold transition ${
            value === "none"
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          None
        </button>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded border border-border bg-card"
          aria-label="Background colour"
        />
      </div>
      {hint ? (
        <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}
