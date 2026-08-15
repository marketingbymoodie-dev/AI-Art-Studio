import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { shopNameToHandle } from "@shared/creatorMarketplace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { SOCIAL_PLATFORMS, CREATOR_PAYOUT_METHODS } from "@shared/creatorMarketplace";
import { DEFAULT_LANDING_CONTENT, type LandingContent } from "@shared/landingContent";
import { Loader2 } from "lucide-react";

type Track = "creator" | "shopify";

export default function CreatorApplyPage() {
  const [location] = useLocation();
  const track: Track = useMemo(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search;
    return new URLSearchParams(query).get("track") === "shopify" ? "shopify" : "creator";
  }, [location]);

  const { data } = useQuery<{ content: LandingContent }>({
    queryKey: ["/api/creators/landing"],
  });
  const copy = data?.content.copy ?? DEFAULT_LANDING_CONTENT.copy;
  const { toast } = useToast();
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    shopName: "",
    socialPlatform: "instagram",
    socialUsername: "",
    followerCount: "",
    niche: "",
    shopifyStoreUrl: "",
    payoutMethod: "paypal",
    payoutDetail: "",
  });
  const [shopNameQuery, setShopNameQuery] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setShopNameQuery(form.shopName.trim()), 350);
    return () => window.clearTimeout(t);
  }, [form.shopName]);

  const shopHandle = shopNameToHandle(form.shopName);
  const { data: shopAvail } = useQuery<{
    available: boolean;
    handle?: string | null;
    error?: string;
    code?: string;
  }>({
    queryKey: ["/api/creators/shop-name-available", shopNameQuery],
    queryFn: async () => {
      const res = await fetch(
        `/api/creators/shop-name-available?name=${encodeURIComponent(shopNameQuery)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.error) throw new Error("Could not check shop name");
      return data;
    },
    enabled: shopNameQuery.length >= 2,
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/creators/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          shopName: form.shopName,
          socialPlatform: track === "creator" ? form.socialPlatform : "other",
          socialUsername: track === "creator" ? form.socialUsername : form.shopifyStoreUrl,
          followerCount: form.followerCount ? Number(form.followerCount) : null,
          niche: track === "creator" ? form.niche : "Shopify store owner",
          hasShopifyStore: track === "shopify",
          shopifyStoreUrl: track === "shopify" ? form.shopifyStoreUrl : null,
          payoutMethod: track === "creator" ? form.payoutMethod : null,
          payoutDetail: track === "creator" ? form.payoutDetail : null,
          termsAccepted: terms,
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

  if (submittedId) {
    return (
      <ApplyShell>
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <p className="luxe-kicker">{track === "shopify" ? copy.shopifyEyebrow : copy.applyEyebrow}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{copy.thanksTitle}</h1>
          <p className="mt-4 text-white/60">{copy.thanksLede}</p>
          <Button asChild className="mt-8" variant="secondary">
            <Link href="/beta">Back to landing</Link>
          </Button>
        </div>
      </ApplyShell>
    );
  }

  const title = track === "shopify" ? copy.shopifyTitle : copy.applyTitle;
  const lede = track === "shopify" ? copy.shopifyLede : copy.applyLede;
  const termsText = track === "shopify" ? copy.shopifyTerms : copy.applyTerms;
  const submitLabel = track === "shopify" ? copy.shopifySubmit : copy.applySubmit;

  return (
    <ApplyShell>
      <div className="mx-auto max-w-xl px-4 py-12">
        <p className="luxe-kicker">{track === "shopify" ? copy.shopifyEyebrow : copy.applyEyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-3 text-white/60">{lede}</p>
        <p className="mt-2 text-sm text-white/40">
          {track === "shopify" ? (
            <Link href="/creators/apply" className="underline underline-offset-2">
              Apply as a creator instead
            </Link>
          ) : (
            <Link href="/creators/apply?track=shopify" className="underline underline-offset-2">
              Already have a Shopify store?
            </Link>
          )}
        </p>

        <form
          className="mt-8 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <Input
                required
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                data-testid="creator-apply-first-name"
              />
            </Field>
            <Field label="Last name">
              <Input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              data-testid="creator-apply-email"
            />
          </Field>
          <Field label="Shop name">
            <Input
              required
              placeholder="Mad Clown Core"
              value={form.shopName}
              onChange={(e) => set("shopName", e.target.value)}
              data-testid="creator-apply-shop-name"
            />
            <p className="text-xs text-white/40">
              Your public store name — not your personal name, unless that is the store name.
              This becomes your URL
              {shopHandle ? (
                <>
                  : <span className="text-white/70">{shopHandle}.aiartstudio.app</span>
                </>
              ) : (
                "."
              )}
            </p>
            {form.shopName.trim() && !shopHandle ? (
              <p className="text-xs text-red-300">
                Use 2–32 letters, numbers, or spaces. Reserved words like www or admin cannot be
                used.
              </p>
            ) : shopAvail && shopAvail.available === false ? (
              <p className="text-xs text-red-300" data-testid="creator-apply-shop-taken">
                {shopAvail.error || "That shop name is already taken."}
              </p>
            ) : null}
          </Field>

          {track === "creator" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Platform">
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
                </Field>
                <Field label="Handle">
                  <Input
                    required
                    placeholder="@yourname"
                    value={form.socialUsername}
                    onChange={(e) => set("socialUsername", e.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Follower count">
                  <Input
                    type="number"
                    min={0}
                    value={form.followerCount}
                    onChange={(e) => set("followerCount", e.target.value)}
                  />
                </Field>
                <Field label="Niche">
                  <Input
                    required
                    placeholder="Pets, streetwear, décor…"
                    value={form.niche}
                    onChange={(e) => set("niche", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="How should we pay you when you earn?">
                <Select value={form.payoutMethod} onValueChange={(v) => set("payoutMethod", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATOR_PAYOUT_METHODS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p === "paypal" ? "PayPal" : p === "bank" ? "Bank transfer" : "Stripe"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payout details">
                <Input
                  required
                  placeholder="PayPal email or account name"
                  value={form.payoutDetail}
                  onChange={(e) => set("payoutDetail", e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label="Shopify store URL">
              <Input
                type="url"
                required
                placeholder="https://your-store.myshopify.com"
                value={form.shopifyStoreUrl}
                onChange={(e) => set("shopifyStoreUrl", e.target.value)}
              />
            </Field>
          )}

          <label className="flex items-start gap-3 text-sm text-white/70">
            <Checkbox checked={terms} onCheckedChange={(c) => setTerms(!!c)} className="mt-0.5" />
            <span>{termsText}</span>
          </label>

          <Button
            type="submit"
            disabled={
              mutation.isPending ||
              !terms ||
              shopAvail?.available === false ||
              (!!form.shopName.trim() && !shopHandle)
            }
            data-testid="creator-apply-submit"
          >
            {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </form>
      </div>
    </ApplyShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-white/70">{label}</Label>
      {children}
    </div>
  );
}

function ApplyShell({ children }: { children: ReactNode }) {
  return (
    <div className="luxe-apply min-h-screen bg-[#07070b] text-[#f5f5f7]">
      <style>{`.luxe-kicker{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:rgba(245,245,247,.55)}.luxe-apply input,.luxe-apply textarea,.luxe-apply button[role=combobox]{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.16);color:#fff}`}</style>
      <header className="border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <Link href="/beta" className="font-semibold">
            AI Art Studio
          </Link>
          <Link href="/beta" className="text-sm text-white/50 hover:text-white">
            Back
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
