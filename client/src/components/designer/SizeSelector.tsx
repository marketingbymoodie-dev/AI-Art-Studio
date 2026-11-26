import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { comboIsMinted, type ShopifyVariantMatchEntry } from "@shared/shopifyVariantMatch";
import type { PrintSize } from "./types";

interface SizeSelectorProps {
  sizes: PrintSize[];
  selectedSize: string;
  onSizeChange: (sizeId: string) => void;
  showLabel?: boolean;
  /** Override label — phone cases use "Model". */
  label?: string;
  prices?: Record<string, number>;
  /**
   * Shop-currency ISO to append after `$40.95` when presentment ≠ shop.
   * DISPLAY ONLY — do not change `prices` cents. Omit when USD is active.
   */
  priceCurrencyCode?: string | null;
  /** Size ids that are out of stock for the current colour (Product Intelligence). */
  outOfStockSizeIds?: Set<string> | string[];
  /** Minted Shopify catalog — greys sizes that are not minted for the selected colour. */
  mintedCatalog?: ShopifyVariantMatchEntry[] | null;
  selectedColorName?: string;
  selectedColorId?: string;
}

export function SizeSelector({
  sizes,
  selectedSize,
  onSizeChange,
  showLabel = true,
  label = "Size",
  prices,
  priceCurrencyCode,
  outOfStockSizeIds,
  mintedCatalog = null,
  selectedColorName,
  selectedColorId,
}: SizeSelectorProps) {
  const oos =
    outOfStockSizeIds instanceof Set
      ? outOfStockSizeIds
      : new Set(outOfStockSizeIds || []);
  const catalog = mintedCatalog && mintedCatalog.length > 0 ? mintedCatalog : null;
  const colorName = String(selectedColorName || "").trim();
  const colorId = String(selectedColorId || "").trim();
  const hasColor = !!(colorName || colorId);

  return (
    <div className="space-y-1">
      {showLabel && <Label className="text-xs">{label}</Label>}
      <Select value={selectedSize} onValueChange={onSizeChange}>
        <SelectTrigger data-testid="select-size" className="h-9">
          <SelectValue placeholder={`Select a ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-64 overflow-y-auto">
          {sizes.map((size) => {
            const stockOut = oos.has(size.id);
            const unminted =
              !!catalog &&
              hasColor &&
              !comboIsMinted(catalog, size.name, colorName, colorId || undefined);
            const disabled = stockOut || unminted;
            const reason = unminted
              ? "Not available in this colour"
              : stockOut
                ? "Out of stock"
                : "";
            return (
              <SelectItem
                key={size.id}
                value={size.id}
                disabled={disabled}
                title={disabled ? reason : undefined}
                data-testid={`option-size-${size.id}`}
              >
                <span className={disabled ? "opacity-50" : undefined}>
                  {size.name}
                  {prices?.[size.id]
                    ? ` - $${(prices[size.id] / 100).toFixed(2)}${priceCurrencyCode ? ` ${priceCurrencyCode}` : ""}`
                    : ""}
                  {reason ? ` — ${reason}` : ""}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
