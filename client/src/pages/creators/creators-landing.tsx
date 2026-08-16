import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CreatorMarketingShell } from "@/components/creators/CreatorMarketingShell";

export default function CreatorsLandingPage() {
  return (
    <CreatorMarketingShell>
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Your AI merch storefront. Live in days, not months.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            For creators and micro-influencers without a Shopify store: AI Art Studio hosts a branded
            shop at <span className="font-mono text-foreground">yourname.aiartstudio.app</span> with
            customizer pages your audience can actually use — not just look at.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/creators/apply">Apply as a creator</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/portal/login">Creator Portal</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/30 py-14">
        <div className="container mx-auto grid max-w-4xl gap-10 px-4 md:grid-cols-3">
          {[
            {
              step: "1",
              title: "Apply",
              body: "Tell us about your niche, audience, and the products you want to sell.",
            },
            {
              step: "2",
              title: "We build your shop",
              body: "Username, subdomain, 1–3 products, customizer pages, and your branding.",
            },
            {
              step: "3",
              title: "Share & earn",
              body: "Drive traffic from Instagram, TikTok, or YouTube. Keep product profits in beta.",
            },
          ].map((s) => (
            <div key={s.step}>
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s.step}
              </div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-2xl font-bold">Example niches we already support</h2>
        <ul className="mt-6 space-y-4 text-muted-foreground">
          <li>
            <strong className="text-foreground">Pet creators</strong> — generate a portrait of a dog
            or cat and print it on hoodies, posters, or pillows.
          </li>
          <li>
            <strong className="text-foreground">Apparel / streetwear</strong> — AI graphics and motifs
            placed on tees and hoodies with the same designer used in merchant stores.
          </li>
          <li>
            <strong className="text-foreground">Home & décor</strong> — framed prints, mugs, and
            soft goods with live mockups before checkout.
          </li>
        </ul>
        <p className="mt-8 text-sm text-muted-foreground">
          Individual creator storefronts stay focused on that creator — no marketplace nav that
          sends customers to other shops. A public directory of live creators may appear here later;
          rankings and earnings stay private in the Creator Portal.
        </p>
      </section>
    </CreatorMarketingShell>
  );
}
