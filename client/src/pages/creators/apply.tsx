import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { CreatorMarketingShell } from "@/components/creators/CreatorMarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { SOCIAL_PLATFORMS } from "@shared/creatorMarketplace";
import { Loader2 } from "lucide-react";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  socialPlatform: string;
  socialUsername: string;
  socialUrl: string;
  followerCount: string;
  niche: string;
  audienceDescription: string;
  hasShopifyStore: boolean;
  shopifyStoreUrl: string;
  interestedProducts: string;
  preferredCategory: string;
  whyParticipate: string;
  expectedReach: string;
  additionalInfo: string;
};

const empty: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  socialPlatform: "instagram",
  socialUsername: "",
  socialUrl: "",
  followerCount: "",
  niche: "",
  audienceDescription: "",
  hasShopifyStore: false,
  shopifyStoreUrl: "",
  interestedProducts: "",
  preferredCategory: "",
  whyParticipate: "",
  expectedReach: "",
  additionalInfo: "",
};

export default function CreatorApplyPage() {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(empty);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/creators/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          followerCount: form.followerCount ? Number(form.followerCount) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit application");
      return data as { application: { id: string } };
    },
    onSuccess: (data) => {
      setSubmittedId(data.application.id);
      toast({ title: "Application received", description: "We'll email you when we've reviewed it." });
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (submittedId) {
    return (
      <CreatorMarketingShell ctaHref="/beta" ctaLabel="Back to beta">
        <div className="container mx-auto max-w-lg px-4 py-24 text-center">
          <h1 className="text-3xl font-bold">Thanks — you&apos;re in the queue</h1>
          <p className="mt-4 text-muted-foreground">
            We received your Creator Beta application. Our team will review it and follow up by
            email. No automated messages are sent until we enable them.
          </p>
          <Button asChild className="mt-8">
            <Link href="/beta">Return to beta overview</Link>
          </Button>
        </div>
      </CreatorMarketingShell>
    );
  }

  return (
    <CreatorMarketingShell>
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold">Apply for the Creator Beta</h1>
        <p className="mt-2 text-muted-foreground">
          Tell us about your audience and how you&apos;d use AI-powered merch. Takes a few minutes.
        </p>

        <form
          className="mt-8 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                required
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                data-testid="creator-apply-first-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                required
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              data-testid="creator-apply-email"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Social platform</Label>
              <Select value={form.socialPlatform} onValueChange={(v) => set("socialPlatform", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOCIAL_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="socialUsername">Social username</Label>
              <Input
                id="socialUsername"
                required
                value={form.socialUsername}
                onChange={(e) => set("socialUsername", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="socialUrl">Profile URL</Label>
              <Input
                id="socialUrl"
                type="url"
                placeholder="https://"
                value={form.socialUrl}
                onChange={(e) => set("socialUrl", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followerCount">Follower count</Label>
              <Input
                id="followerCount"
                type="number"
                min={0}
                value={form.followerCount}
                onChange={(e) => set("followerCount", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="niche">Niche</Label>
            <Input
              id="niche"
              required
              placeholder="e.g. Pet parenting, streetwear, home décor"
              value={form.niche}
              onChange={(e) => set("niche", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="audienceDescription">Audience description</Label>
            <Textarea
              id="audienceDescription"
              rows={3}
              value={form.audienceDescription}
              onChange={(e) => set("audienceDescription", e.target.value)}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border p-4">
            <Checkbox
              id="hasShopify"
              checked={form.hasShopifyStore}
              onCheckedChange={(c) => set("hasShopifyStore", !!c)}
            />
            <div className="space-y-2 flex-1">
              <Label htmlFor="hasShopify" className="font-normal">
                I already have a Shopify store
              </Label>
              {form.hasShopifyStore && (
                <Input
                  placeholder="https://your-store.myshopify.com"
                  value={form.shopifyStoreUrl}
                  onChange={(e) => set("shopifyStoreUrl", e.target.value)}
                  required
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interestedProducts">Products you&apos;re interested in</Label>
            <Input
              id="interestedProducts"
              placeholder="Hoodies, posters, phone cases…"
              value={form.interestedProducts}
              onChange={(e) => set("interestedProducts", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="preferredCategory">Preferred product category</Label>
            <Input
              id="preferredCategory"
              placeholder="Apparel, décor, accessories…"
              value={form.preferredCategory}
              onChange={(e) => set("preferredCategory", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="whyParticipate">Why do you want to participate?</Label>
            <Textarea
              id="whyParticipate"
              rows={3}
              value={form.whyParticipate}
              onChange={(e) => set("whyParticipate", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expectedReach">Expected audience reach</Label>
            <Input
              id="expectedReach"
              placeholder="e.g. 50k Instagram, engaged community"
              value={form.expectedReach}
              onChange={(e) => set("expectedReach", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="additionalInfo">Anything else?</Label>
            <Textarea
              id="additionalInfo"
              rows={2}
              value={form.additionalInfo}
              onChange={(e) => set("additionalInfo", e.target.value)}
            />
          </div>

          <Button type="submit" disabled={mutation.isPending} data-testid="creator-apply-submit">
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit application
          </Button>
        </form>
      </div>
    </CreatorMarketingShell>
  );
}
