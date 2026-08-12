import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  setCreatorPortalToken,
  type CreatorPortalProfile,
} from "@/lib/creator-portal-auth";
import { Loader2 } from "lucide-react";

export default function CreatorPortalLoginPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");

  const requestOtp = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/creator/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send code");
      return data;
    },
    onSuccess: () => {
      setStep("code");
      toast({
        title: "Check your email",
        description: "If that address is registered, we sent a 6-digit code.",
      });
    },
    onError: (e: Error) => toast({ title: "Could not send code", description: e.message, variant: "destructive" }),
  });

  const verifyOtp = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/creator/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Invalid code");
      return data as { token: string; creator: CreatorPortalProfile };
    },
    onSuccess: (data) => {
      setCreatorPortalToken(data.token);
      setLocation("/portal");
    },
    onError: (e: Error) => toast({ title: "Sign-in failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-100 via-amber-50/40 to-stone-50 text-stone-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium tracking-wide text-stone-500">AI Art Studio</p>
          <h1 className="mt-2 font-serif text-3xl tracking-tight">Creator Portal</h1>
          <p className="mt-2 text-sm text-stone-600">
            Sign in with the email on your creator account.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200/80 bg-white/80 p-6 shadow-sm backdrop-blur">
          {step === "email" ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                requestOtp.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={requestOtp.isPending || !email.trim()}>
                {requestOtp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send login code"}
              </Button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                verifyOtp.mutate();
              }}
            >
              <p className="text-sm text-stone-600">
                Code sent to <span className="font-medium text-stone-900">{email}</span>
              </p>
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="tracking-[0.35em] text-center text-lg"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={verifyOtp.isPending || code.length < 6}>
                {verifyOtp.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-stone-500 underline-offset-2 hover:underline"
                onClick={() => {
                  setStep("email");
                  setCode("");
                }}
              >
                Use a different email
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-stone-500">
          Not a creator yet?{" "}
          <Link href="/creators/apply" className="font-medium text-stone-800 underline-offset-2 hover:underline">
            Apply for the beta
          </Link>
        </p>
      </div>
    </div>
  );
}
