import { shadeSpectrum } from "@/components/designer/openEyeDropper";

type ShadeSpectrumRowProps = {
  hex: string | null | undefined;
  selected?: string | null;
  onPick: (hex: string) => void;
};

/** Lighter/darker chips for the current (or last picked) colour. */
export function ShadeSpectrumRow({
  hex,
  selected,
  onPick,
}: ShadeSpectrumRowProps) {
  if (!hex || hex === "none" || hex === "transparent") return null;
  const shades = shadeSpectrum(hex);
  if (shades.length < 2) return null;
  const current = (selected ?? hex).toUpperCase();
  return (
    <div className="mt-2" data-testid="picked-shade-spectrum">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Shades
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shades.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            title={s}
            aria-label={`Use shade ${s}`}
            className={`h-6 w-6 rounded border-2 transition ${
              current === s
                ? "border-primary ring-2 ring-primary/40"
                : "border-border hover:border-foreground/40"
            }`}
            style={{ backgroundColor: s }}
          />
        ))}
      </div>
    </div>
  );
}
