import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

export type NewsletterSignupSource = "merchant" | "creator" | "store_user";

type Props = {
  source: NewsletterSignupSource;
  shopDomain?: string | null;
  creatorUsername?: string | null;
  customerId?: string | null;
  variant?: "default" | "muted" | "luxe";
  className?: string;
};

export function StudioNewsletterSignup({
  source,
  shopDomain,
  creatorUsername,
  customerId,
  variant = "default",
  className = "",
}: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source,
          shop: shopDomain || undefined,
          creatorUsername: creatorUsername || undefined,
          customerId: customerId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not join the list.");
      if (data.creditGranted && data.creditAmount > 0) {
        setDone(`You're on the list — ${data.creditAmount} Studio Credit added.`);
      } else if (data.alreadySubscribed) {
        setDone("You're already on the Studio Art Class list.");
      } else if (source === "store_user" && !customerId) {
        setDone("You're on the list. Sign in so we can add your Studio Credit.");
      } else {
        setDone("You're on the Studio Art Class list.");
      }
    } catch (err: any) {
      setError(err?.message || "Could not join the list.");
    } finally {
      setLoading(false);
    }
  };

  const isLuxe = variant === "luxe";
  const isMuted = variant === "muted";

  return (
    <div className={className}>
      <p className={isLuxe ? "text-sm text-white/70 mb-2" : "text-sm text-muted-foreground mb-2"}>
        Join the Studio Art Class list. If a signup credit is enabled, Studio issues it — it does
        not come off a shop quota.
      </p>
      {done ? (
        <p className={isLuxe ? "text-sm text-white" : "text-sm font-medium"}>{done}</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className={isLuxe ? "bg-white/10 border-white/20 text-white placeholder:text-white/40" : ""}
          />
          <Button type="submit" disabled={loading} variant={isMuted ? "outline" : "default"}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join"}
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}
