import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_CREATOR_SOCIALS,
  SOCIAL_PLATFORMS,
  normalizeSocialHandle,
  socialPlatformLabel,
  stripLeadingAtSigns,
} from "@shared/creatorMarketplace";
import { Plus, Trash2 } from "lucide-react";

export type SocialDraft = { platform: string; username: string };

export function emptySocialDraft(): SocialDraft {
  return { platform: "instagram", username: "" };
}

type Props = {
  value: SocialDraft[];
  onChange: (next: SocialDraft[]) => void;
  requiredFirst?: boolean;
  hint?: string;
};

export function CreatorSocialsFields({
  value,
  onChange,
  requiredFirst = false,
  hint = "Up to 4 handles. Don’t include @ — we add it when we show the link.",
}: Props) {
  const rows = value.length > 0 ? value : [emptySocialDraft()];

  const update = (index: number, patch: Partial<SocialDraft>) => {
    onChange(
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if (patch.username !== undefined) {
          next.username = stripLeadingAtSigns(patch.username);
        }
        return next;
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Social handles</Label>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      {rows.map((row, index) => {
        const normalized = row.username.trim() ? normalizeSocialHandle(row.username) : "";
        const invalid = !!row.username.trim() && !normalized;
        return (
          <div key={index} className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <Select value={row.platform} onValueChange={(v) => update(index, { platform: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOCIAL_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {socialPlatformLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <Input
                required={requiredFirst && index === 0}
                placeholder="yourname"
                value={row.username}
                onChange={(e) => update(index, { username: e.target.value })}
                onBlur={() => {
                  const cleaned = normalizeSocialHandle(row.username);
                  if (cleaned && cleaned !== row.username) {
                    update(index, { username: cleaned });
                  }
                }}
                aria-invalid={invalid}
              />
              {invalid ? (
                <p className="text-xs text-destructive">
                  Remove extra @ symbols. Use letters, numbers, periods, or underscores.
                </p>
              ) : null}
            </div>
            {rows.length > 1 ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove handle"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        );
      })}
      {rows.length < MAX_CREATOR_SOCIALS ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...rows, emptySocialDraft()])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add another handle
        </Button>
      ) : null}
    </div>
  );
}
