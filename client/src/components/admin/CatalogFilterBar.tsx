import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { PLATFORM_CATALOG_CATEGORIES } from "@shared/platformCatalogCategories";
import { PRINTIFY_SHIPPING_REGIONS, type PrintifyShippingRegionId } from "@shared/printifyShippingRegions";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  shipsFrom?: PrintifyShippingRegionId;
  onShipsFromChange?: (value: PrintifyShippingRegionId) => void;
  shipsTo?: PrintifyShippingRegionId;
  onShipsToChange?: (value: PrintifyShippingRegionId) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  shippingMetaLoading?: boolean;
  shippingFilterActive?: boolean;
  resultCount?: number;
  totalCount?: number;
  searchPlaceholder?: string;
  showShippingFilters?: boolean;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
  showStatusFilter?: boolean;
};

export default function CatalogFilterBar({
  search,
  onSearchChange,
  shipsFrom = "all",
  onShipsFromChange,
  shipsTo = "all",
  onShipsToChange,
  category,
  onCategoryChange,
  shippingMetaLoading,
  shippingFilterActive,
  resultCount,
  totalCount,
  searchPlaceholder = "Search products...",
  showShippingFilters = true,
  statusFilter,
  onStatusFilterChange,
  showStatusFilter = false,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[180px] flex-1">
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="input-catalog-search"
          />
        </div>
        {showShippingFilters && onShipsFromChange && onShipsToChange && (
          <>
            <Select value={shipsFrom} onValueChange={(v) => onShipsFromChange(v as PrintifyShippingRegionId)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Ships from" />
              </SelectTrigger>
              <SelectContent>
                {PRINTIFY_SHIPPING_REGIONS.map((r) => (
                  <SelectItem key={`from-${r.id}`} value={r.id}>
                    Ships from: {r.id === "all" ? "Any" : r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={shipsTo} onValueChange={(v) => onShipsToChange(v as PrintifyShippingRegionId)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Ships to" />
              </SelectTrigger>
              <SelectContent>
                {PRINTIFY_SHIPPING_REGIONS.map((r) => (
                  <SelectItem key={`to-${r.id}`} value={r.id}>
                    Ships to: {r.id === "all" ? "Any" : r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {PLATFORM_CATALOG_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showStatusFilter && onStatusFilterChange && (
          <Select value={statusFilter ?? "all"} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="preview">Preview</SelectItem>
              <SelectItem value="active">Live</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {showShippingFilters && shippingMetaLoading && shippingFilterActive && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading shipping data…
        </p>
      )}
      {typeof resultCount === "number" && typeof totalCount === "number" && (
        <p className="text-xs text-muted-foreground">
          Showing {resultCount} of {totalCount} products
        </p>
      )}
    </div>
  );
}
