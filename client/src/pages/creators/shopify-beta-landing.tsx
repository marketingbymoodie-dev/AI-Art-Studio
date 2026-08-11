import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CreatorMarketingShell } from "@/components/creators/CreatorMarketingShell";

export default function ShopifyBetaLandingPage() {
  return (
    <CreatorMarketingShell ctaHref="/creators/apply" ctaLabel="Apply as a merchant">
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            AI customizer pages on your Shopify store — beta invite
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Already selling on Shopify? Join the AI Art Studio merchant beta to put selected
            customizer pages live in your store: free access for 30 days, an included AI generation
            allowance, analytics, and no subscription charge during the trial.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/creators/apply">Apply with your Shopify store</Link>
          </Button>
        </div>
      </section>

      <section className="border-y bg-muted/30 py-14">
        <div className="container mx-auto max-w-3xl space-y-6 px-4">
          <h2 className="text-2xl font-bold">What you get</h2>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Customizer pages that mount on your theme via the AI Art Studio App Embed</li>
            <li>AI styles already used by merchants — pet portraits, apparel graphics, décor</li>
            <li>Shadow-SKU checkout mockups so customers see their design in cart and checkout</li>
            <li>You keep normal product profits; we learn from usage and feedback</li>
          </ul>
          <h2 className="pt-4 text-2xl font-bold">What we ask</h2>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Real traffic on the selected products during the beta window</li>
            <li>Constructive feedback and a short review when ready</li>
            <li>Optional permission to use anonymised results in case studies</li>
          </ul>
        </div>
      </section>

      <section className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted-foreground">
          Don&apos;t have a Shopify store?{" "}
          <Link href="/creators" className="font-medium text-foreground underline">
            See the creator storefront path
          </Link>
          .
        </p>
      </section>
    </CreatorMarketingShell>
  );
}
