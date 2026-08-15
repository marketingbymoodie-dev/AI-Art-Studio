import { useState } from "react";
import { Check, ChevronDown, Eye } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { StylePreset } from "./types";
import { displayCreatorStyleName } from "@shared/creatorMarketplace";
import { styleExampleImageUrl } from "@shared/customizerPageStyles";
import { cn } from "@/lib/utils";

interface StyleSelectorProps {
  stylePresets: StylePreset[];
  selectedStyle: string;
  onStyleChange: (styleId: string) => void;
  showLabel?: boolean;
}

export function StyleSelector({
  stylePresets,
  selectedStyle,
  onStyleChange,
  showLabel = true,
}: StyleSelectorProps) {
  const [listOpen, setListOpen] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const selectedPreset = stylePresets.find((s) => s.id === selectedStyle);
  const selectedName = selectedPreset
    ? displayCreatorStyleName(selectedPreset.name)
    : null;
  const selectedExample = selectedPreset ? styleExampleImageUrl(selectedPreset) : null;

  const openPreview = (style: StylePreset) => {
    const url = styleExampleImageUrl(style);
    if (!url) return;
    setListOpen(false);
    setPreview({ name: displayCreatorStyleName(style.name), url });
  };

  return (
    <div className="space-y-1">
      {showLabel && <Label className="text-xs">Art Style</Label>}
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="select-style"
            className={cn(
              "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            )}
          >
            <span className={cn("truncate", !selectedName && "text-muted-foreground")}>
              {selectedName || "Choose an art style"}
            </span>
            <span className="ml-2 flex shrink-0 items-center gap-1">
              {selectedExample && selectedPreset ? (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Preview ${selectedName} example`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openPreview(selectedPreset);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    e.stopPropagation();
                    openPreview(selectedPreset);
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                </span>
              ) : null}
              <ChevronDown className="h-4 w-4 opacity-50" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          <div className="max-h-72 overflow-y-auto">
            {stylePresets.map((style) => {
              const name = displayCreatorStyleName(style.name);
              const exampleUrl = styleExampleImageUrl(style);
              const selected = style.id === selectedStyle;
              return (
                <div
                  key={style.id}
                  className="flex items-center gap-1 rounded-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
                    onClick={() => {
                      onStyleChange(style.id);
                      setListOpen(false);
                    }}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{name}</span>
                  </button>
                  {exampleUrl ? (
                    <button
                      type="button"
                      aria-label={`Preview ${name} example`}
                      className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openPreview(style);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{preview?.name || "Style example"}</DialogTitle>
            <DialogDescription>Example of this art style.</DialogDescription>
          </DialogHeader>
          {preview ? (
            <img
              src={preview.url}
              alt={`${preview.name} example`}
              className="max-h-[70vh] w-full rounded-md bg-muted object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
