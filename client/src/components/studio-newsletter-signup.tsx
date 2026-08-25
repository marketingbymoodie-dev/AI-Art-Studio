import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/urlBase";
import { safeFetch } from "@/lib/safeFetch";

export type NewsletterSignupSource = "merchant" | "creator" | "store_user";

type Props = {
  source: NewsletterSignupSource;
  shopDomain?: string | null;
  creatorUsername?: string | null;
  customerId?: string | null;
  variant?: "default" | "muted" | "luxe" | "compact";
  className?: string;
  hideIntro?: boolean;
  /** Fired when a Studio Credit was actually granted (so the badge can refresh). */
  onCreditGranted?: (amount: number) => void;
};

const SUBSCRIBE_TIMEOUT_MS = 12_000;

export function StudioNewsletterSignup({
  source,
  shopDomain,
  creatorUsername,
  customerId,
  variant = "default",
  className = "",
  hideIntro = false,
  onCreditGranted,
}: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const join = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await safeFetch(
        `${API_BASE}/api/studio/newsletter/subscribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            source,
            shop: shopDomain || undefined,
            creatorUsername: creatorUsername || undefined,
            customerId: customerId || undefined,
          }),
        },
        SUBSCRIBE_TIMEOUT_MS,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not join the list.");
      if (data.alreadySubscribed) {
        setDone("This email is already on the Studio Art Class list.");
      } else if (data.creditGranted && data.creditAmount > 0) {
        setDone(`You're on the list — ${data.creditAmount} Studio Credit added.`);
        onCreditGranted?.(Number(data.creditAmount) || 1);
      } else if (data.creditAlreadyClaimed) {
        setDone(
          "You're on the list. Your Art Class credit for this shop was already claimed.",
        );
      } else if (source === "store_user" && !customerId) {
        setDone("You're on the list. Sign in so we can add your Studio Credit.");
      } else {
        setDone("You're on the Studio Art Class list.");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError("That took too long. Check your connection and try again.");
      } else {
        setError(err?.message || "Could not join the list.");
      }
    } finally {
      setLoading(false);
    }
  };

  const isLuxe = variant === "luxe";
  const isMuted = variant === "muted" || variant === "compact";

  return (
    <div
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!hideIntro && (
        <p className={isLuxe ? "text-sm text-white/70 mb-2" : "text-sm text-muted-foreground mb-2"}>
          Join the Studio Art Class list. Discover prompt tips and tricks, inspiration from others and more.
        </p>
      )}
      {done ? (
        <p className={isLuxe ? "text-sm text-white" : "text-sm font-medium"}>{done}</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className={isLuxe ? "bg-white/10 border-white/20 text-white placeholder:text-white/40" : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (email.trim()) void join();
              }
            }}
          />
          <Button
            type="button"
            disabled={loading || !email.trim()}
            variant={isMuted ? "outline" : "default"}
            onClick={() => void join()}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}
