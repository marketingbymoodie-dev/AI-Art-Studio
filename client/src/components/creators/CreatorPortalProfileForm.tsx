import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CreatorProfileImageField } from "@/components/creators/CreatorProfileImageField";
import {
  creatorPortalFetch,
  type CreatorPortalProfile,
} from "@/lib/creator-portal-auth";
import {
  CREATOR_HEADING_FONTS,
  CREATOR_HEADING_FONTS_STYLESHEET,
  creatorPublicName,
  parseCreatorHeadingFontId,
} from "@shared/creatorMarketplace";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export function CreatorPortalProfileForm({ creator }: { creator: CreatorPortalProfile }) {
  const qc = useQueryClient();
  const branding = creator.branding || {};
  const [shopName, setShopName] = useState(
    typeof branding.headline === "string" ? branding.headline : "",
  );
  const [headingFont, setHeadingFont] = useState(parseCreatorHeadingFontId(branding.headingFont));
  const [shopDescription, setShopDescription] = useState(
    typeof branding.description === "string" ? branding.description : "",
  );
  const [bio, setBio] = useState(creator.bio || "");
  const [profileImageUrl, setProfileImageUrl] = useState(creator.profileImageUrl || "");
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    typeof branding.backgroundImageUrl === "string" ? branding.backgroundImageUrl : "",
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = "creator-heading-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = CREATOR_HEADING_FONTS_STYLESHEET;
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const b = creator.branding || {};
    setShopName(typeof b.headline === "string" ? b.headline : "");
    setHeadingFont(parseCreatorHeadingFontId(b.headingFont));
    setShopDescription(typeof b.description === "string" ? b.description : "");
    setBio(creator.bio || "");
    setProfileImageUrl(creator.profileImageUrl || "");
    setBackgroundImageUrl(
      typeof b.backgroundImageUrl === "string" ? b.backgroundImageUrl : "",
    );
  }, [creator]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await creatorPortalFetch("/api/creator/profile", {
        method: "PATCH",
        body: JSON.stringify({
          shopName,
          headingFont,
          shopDescription,
          bio,
          profileImageUrl: profileImageUrl || null,
          backgroundImageUrl: backgroundImageUrl || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to save profile");
      return body.creator as CreatorPortalProfile;
    },
    onSuccess: (updated) => {
      qc.setQueryData(["creator-portal-me"], updated);
      qc.invalidateQueries({ queryKey: ["creator-portal-me"] });
      setMessage("Profile saved. Refresh your shop to see it.");
    },
    onError: (err: Error) => {
      setMessage(err.message);
    },
  });

  const previewName = creatorPublicName({
    username: creator.username,
    branding: { ...branding, headline: shopName.trim() || undefined },
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Public profile
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Customers see <span className="font-medium">{previewName}</span> — not your
          legal name — unless you type it into About.
        </p>
      </div>

      <div className="space-y-1">
        <Label>Shop name (handle)</Label>
        <Input
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          placeholder={creator.username}
        />
      </div>
      <div className="space-y-1">
        <Label>Shop name font</Label>
        <Select value={headingFont} onValueChange={setHeadingFont}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREATOR_HEADING_FONTS.map((font) => (
              <SelectItem key={font.id} value={font.id}>
                <span style={font.cssFamily ? { fontFamily: font.cssFamily } : undefined}>
                  {font.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Shop description</Label>
        <Textarea
          rows={2}
          value={shopDescription}
          onChange={(e) => setShopDescription(e.target.value)}
          placeholder="Short line on your home page"
        />
      </div>
      <div className="space-y-1">
        <Label>About</Label>
        <Textarea
          rows={5}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Your story. Add your real name here only if you want it public."
        />
      </div>
      <CreatorProfileImageField
        label="Profile avatar"
        hint="Shown in the header and on your home page."
        value={profileImageUrl}
        onChange={setProfileImageUrl}
        previewClassName="h-16 w-16 rounded-full object-cover border"
      />
      <CreatorProfileImageField
        label="Home background"
        hint="Wide image behind your shop name on the main page."
        value={backgroundImageUrl}
        onChange={setBackgroundImageUrl}
        previewClassName="h-16 w-28 rounded-md object-cover border"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save profile
        </Button>
        {message ? <p className="text-sm text-stone-600">{message}</p> : null}
      </div>
    </div>
  );
}
