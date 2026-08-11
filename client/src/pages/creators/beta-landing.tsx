import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreatorMarketingShell } from "@/components/creators/CreatorMarketingShell";
import { Store, Users, Sparkles, Shirt, Frame, Smartphone } from "lucide-react";

export default function BetaLandingPage() {
  return (
    <CreatorMarketingShell>
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-primary">
            Creator Beta
          </p>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Your audience. Your AI merch store. Your profits.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            We&apos;re inviting creators and Shopify merchants to test a new way to sell personalized
            merchandise — pet portraits, apparel graphics, framed prints, phone cases, and more —
            powered by AI Art Studio&apos;s customizer.
          </p>
          <p className="mt-3 text-base font-medium">
            30 days. $0 upfront. Keep your product profits during beta.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/creators/apply">Apply for the beta</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/creators">See how creator stores work</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/30 py-12">
        <div className="container mx-auto grid gap-6 px-4 md:grid-cols-2">
          <Card className="border-primary/20">
            <CardHeader>
              <Store className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>I have a Shopify store</CardTitle>
              <CardDescription>
                Use AI Art Studio customizer pages on selected products in your existing shop. Keep
                your normal product profits while we learn from real usage.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/shopify-beta">Shopify beta details</Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="border-primary/20">
            <CardHeader>
              <Users className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>I have an audience, no store</CardTitle>
              <CardDescription>
                We spin up a branded storefront like{" "}
                <span className="font-mono text-foreground">you.aiartstudio.app</span> with 1–3
                products and your customizer pages.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/creators">Creator program details</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="container mx-auto px-4 py-16">
        <h2 className="mb-8 text-center text-2xl font-bold">Built on what already works</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Sparkles,
              title: "Pet portraits",
              body: "Turn a photo into a one-of-a-kind portrait — then put it on apparel or décor.",
            },
            {
              icon: Shirt,
              title: "Apparel & AOP",
              body: "Tees, hoodies, and all-over-print styles with the same designer merchants use today.",
            },
            {
              icon: Frame,
              title: "Framed prints & home",
              body: "Posters, pillows, mugs — premium print products with live mockups.",
            },
            {
              icon: Smartphone,
              title: "Phone cases & more",
              body: "Phone cases, totes, and graphics-ready products from the AI Art Studio catalogue.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border p-5">
              <item.icon className="mb-3 h-7 w-7 text-primary" />
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto max-w-2xl px-4 pb-20 text-center">
        <h2 className="text-2xl font-bold">What we ask from beta partners</h2>
        <p className="mt-3 text-muted-foreground">
          Honest feedback, a short review when you&apos;re ready, and permission to share anonymised
          performance learnings as case studies where you agree. We build the technology — you bring
          the audience.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link href="/creators/apply">Start your application</Link>
        </Button>
      </section>
    </CreatorMarketingShell>
  );
}
