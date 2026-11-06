import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Loader2 } from "lucide-react";
import AdminLayout from "@/components/admin-layout";
import {
  MY_PET_ART_STYLES,
  MY_PET_LOCKED_PRINT_RULES,
  type MyPetArtStyle,
  type MyPetSettings,
} from "@shared/myPetSettings";

const STYLE_LABELS: Record<MyPetArtStyle, string> = {
  woodcut: "Woodcut",
  "folk-graphic": "Folk Graphic",
  "bold-type": "Bold Type",
  "pen-ink": "Pen & Ink",
  "vintage-engraving": "Vintage Engraving",
  "retro-character": "Retro Character",
};

export default function MyPetSettingsPage() {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<{ settings: MyPetSettings }>({
    queryKey: ["/api/admin/my-pet-settings"],
  });

  const [basePrompt, setBasePrompt] = useState("");
  const [styleTweaks, setStyleTweaks] = useState<Record<string, string>>({});
  const [capPerListing, setCapPerListing] = useState("2");
  const [capPerDay, setCapPerDay] = useState("20");
  const [capEmailBonus, setCapEmailBonus] = useState("2");

  useEffect(() => {
    if (!data?.settings) return;
    setBasePrompt(data.settings.basePrompt);
    setStyleTweaks(data.settings.styleTweaks || {});
    setCapPerListing(String(data.settings.caps.perListing));
    setCapPerDay(String(data.settings.caps.perDay));
    setCapEmailBonus(String(data.settings.caps.emailBonus));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/my-pet-settings", {
        basePrompt,
        styleTweaks,
        caps: {
          perListing: Number(capPerListing) || 0,
          perDay: Number(capPerDay) || 0,
          emailBonus: Number(capEmailBonus) || 0,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "My Pet settings updated — takes effect immediately, no redeploy." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/my-pet-settings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    },
  });

  if (isError) {
    return (
      <AdminLayout>
        <div className="p-6">
          <p className="text-muted-foreground">My Pet settings are not available for this store.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">My Pet Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Operator-only. One base prompt for every design, plus optional per-style tweaks. Changes take effect
            immediately — no redeploy.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Base prompt</CardTitle>
                <CardDescription>
                  Sent with every My Pet image edit, along with that design's own species, style and wording.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={basePrompt}
                  onChange={(e) => setBasePrompt(e.target.value)}
                  rows={5}
                  data-testid="input-my-pet-base-prompt"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Per-style tweaks</CardTitle>
                <CardDescription>Blank by default. Only appended for a design in that style.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {MY_PET_ART_STYLES.map((style) => (
                  <div key={style} className="space-y-1.5">
                    <Label>{STYLE_LABELS[style]}</Label>
                    <Textarea
                      value={styleTweaks[style] || ""}
                      onChange={(e) => setStyleTweaks((prev) => ({ ...prev, [style]: e.target.value }))}
                      rows={2}
                      placeholder="(none)"
                      data-testid={`input-my-pet-tweak-${style}`}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Print rules</CardTitle>
                <CardDescription>Always appended last. Locked — not editable.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground bg-muted rounded-md p-3">{MY_PET_LOCKED_PRINT_RULES}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Caps</CardTitle>
                <CardDescription>No login — enforced by cookie and IP together. Hitting a cap shows a friendly message, never an error.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Per listing (first go + retries)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={capPerListing}
                    onChange={(e) => setCapPerListing(e.target.value)}
                    data-testid="input-my-pet-cap-listing"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Per day, store-wide</Label>
                  <Input
                    type="number"
                    min={0}
                    value={capPerDay}
                    onChange={(e) => setCapPerDay(e.target.value)}
                    data-testid="input-my-pet-cap-day"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email bonus (per product)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={capEmailBonus}
                    onChange={(e) => setCapEmailBonus(e.target.value)}
                    data-testid="input-my-pet-cap-email-bonus"
                  />
                </div>
              </CardContent>
            </Card>

            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-my-pet-settings">
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
