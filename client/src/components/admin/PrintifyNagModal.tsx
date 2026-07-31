import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useSetupStatus } from "@/hooks/use-setup-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, HelpCircle } from "lucide-react";

const DISMISS_KEY = "appai_printify_nag_dismissed_date";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC) — "once per day"
}

/**
 * Daily nag reminding the merchant to connect Printify once they have a live
 * (or preview) customizer page but haven't connected their own Printify
 * account yet. "Not now" only dismisses the modal for the rest of today —
 * it never unlocks public/fulfillable pages (that gate is enforced
 * server-side regardless of this modal, see docs/merchant-setup-rail.md).
 */
export default function PrintifyNagModal() {
  const { data: status } = useSetupStatus();
  const [, navigate] = useLocation();
  const [dismissedToday, setDismissedToday] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setDismissedToday(localStorage.getItem(DISMISS_KEY) === todayKey());
  }, []);

  const shouldNag = !!status && status.pagesCount > 0 && !status.printifyConnected;
  const open = shouldNag && !dismissedToday;

  const handleNotNow = () => {
    localStorage.setItem(DISMISS_KEY, todayKey());
    setDismissedToday(true);
    setHelpOpen(false);
  };

  const handleConnect = () => {
    localStorage.setItem(DISMISS_KEY, todayKey());
    setDismissedToday(true);
    setHelpOpen(false);
    navigate("/admin/settings");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleNotNow(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-printify-nag">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle>Connect Printify to go live</DialogTitle>
          </div>
          <DialogDescription>
            Your Customizer Page{status && status.pagesCount > 1 ? "s aren't" : " isn't"} visible to
            customers yet — it's only visible to you until you connect your own Printify account, so
            orders can actually be fulfilled and you don't waste AI generations on a page nobody can
            check out from.
          </DialogDescription>
        </DialogHeader>

        {helpOpen && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
            <p className="font-medium">How to connect Printify</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Don't have an account yet?{" "}
                <a
                  href="https://printify.com/app/register"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-foreground"
                >
                  Create a free Printify account
                </a>.
              </li>
              <li>
                In Printify, go to{" "}
                <a
                  href="https://printify.com/app/account/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-foreground"
                >
                  Settings → API tokens
                </a>{" "}
                and generate a new Personal Access Token.
              </li>
              <li>Paste that token into Settings here, then click "Detect Shop" to auto-fill your Shop ID.</li>
              <li>Click Save — your Customizer Pages go live automatically, no extra step.</li>
            </ol>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button onClick={handleConnect} className="w-full" data-testid="button-printify-nag-connect">
            <ExternalLink className="h-4 w-4 mr-2" />
            Connect Printify now
          </Button>
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setHelpOpen((v) => !v)}
              data-testid="button-printify-nag-help"
            >
              <HelpCircle className="h-4 w-4 mr-2" />
              Help
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={handleNotNow}
              data-testid="button-printify-nag-not-now"
            >
              Not now
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
