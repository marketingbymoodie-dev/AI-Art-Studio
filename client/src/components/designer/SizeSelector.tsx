import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PrintSize } from "./types";

interface SizeSelectorProps {
  sizes: PrintSize[];
  selectedSize: string;
  onSizeChange: (sizeId: string) => void;
  showLabel?: boolean;
  /** Override label — phone cases use "Model". */
  label?: string;
  prices?: Record<string, number>;
  /** Size ids that are out of stock for the current colour (Product Intelligence). */
  outOfStockSizeIds?: Set<string> | string[];
}

export function SizeSelector({
  sizes,
  selectedSize,
  onSizeChange,
  showLabel = true,
  label = "Size",
  prices,
  outOfStockSizeIds,
}: SizeSelectorProps) {
  const oos =
    outOfStockSizeIds instanceof Set
      ? outOfStockSizeIds
      : new Set(outOfStockSizeIds || []);

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
            return (
              <SelectItem
                key={size.id}
                value={size.id}
                disabled={stockOut}
                data-testid={`option-size-${size.id}`}
              >
                <span className={stockOut ? "opacity-50" : undefined}>
                  {size.name}
                  {prices?.[size.id] ? ` - $${(prices[size.id] / 100).toFixed(2)}` : ""}
                  {stockOut ? " — Out of stock" : ""}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
