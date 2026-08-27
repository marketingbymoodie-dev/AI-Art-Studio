import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveStoredColorHex } from "@shared/printifyColorResolver";
import { comboIsMinted, type ShopifyVariantMatchEntry } from "@shared/shopifyVariantMatch";
import type { FrameColor } from "./types";

interface FrameColorSelectorProps {
  frameColors: FrameColor[];
  selectedFrameColor: string;
  onFrameColorChange: (colorId: string) => void;
  showLabel?: boolean;
  colorLabel?: string;
  /** Minted Shopify catalog — greys colours that are not minted for the selected size. */
  mintedCatalog?: ShopifyVariantMatchEntry[] | null;
  selectedSizeName?: string;
}

function getDisplayHex(color: FrameColor): string {
  return resolveStoredColorHex(color.name, color.hex).hex;
}

export function FrameColorSelector({
  frameColors,
  selectedFrameColor,
  onFrameColorChange,
  showLabel = true,
  colorLabel = "Color",
  mintedCatalog = null,
  selectedSizeName,
}: FrameColorSelectorProps) {
  const selected = frameColors.find((c) => c.id === selectedFrameColor);
  const isColorOption = colorLabel !== "Option";
  const sizeName = String(selectedSizeName || "").trim();
  const catalog = mintedCatalog && mintedCatalog.length > 0 ? mintedCatalog : null;

  const colorUnminted = (color: FrameColor): boolean => {
    if (!catalog || !sizeName) return false;
    return !comboIsMinted(catalog, sizeName, color.name, color.id);
  };

  return (
    <div className="space-y-1">
      {showLabel && <Label className="text-xs">{colorLabel}</Label>}
      <Select value={selected?.id || undefined} onValueChange={onFrameColorChange}>
        <SelectTrigger data-testid="select-frame-color" className="h-9">
          <SelectValue placeholder={`Select ${colorLabel.toLowerCase()}`}>
            {selected && (
              <span className="flex items-center gap-2">
                {isColorOption && (
                  <span
                    className="inline-block w-3 h-3 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: getDisplayHex(selected) }}
                  />
                )}
                {selected.name}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4} className="z-[200]">
          {frameColors.map((color) => {
            const oos = color.inStock === false;
            const unminted = colorUnminted(color);
            const selectable = !oos && !unminted;
            const reason = oos
              ? "Out of stock"
              : unminted
                ? "Not available in this size"
                : "Unavailable";
            return (
              <SelectItem
                key={color.id}
                value={color.id}
                disabled={!selectable}
                title={selectable ? undefined : reason}
                data-testid={`option-frame-${color.id}`}
              >
                <span className={`flex items-center gap-2 ${!selectable ? "opacity-50" : ""}`}>
                  {isColorOption && (
                    <span
                      className="inline-block w-3 h-3 rounded-full border border-border shrink-0"
                      style={{ backgroundColor: getDisplayHex(color) }}
                    />
                  )}
                  {color.name}
                  {!selectable && (
                    <span className="text-[10px] text-muted-foreground">({reason})</span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
