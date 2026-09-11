import "./mobile-customizer.css";
import { ChevronLeft, HelpCircle, LayoutGrid, LogIn } from "lucide-react";

export type MobileCustomizerShellProps = {
  brandName?: string;
  isLoggedIn: boolean;
  creditsLabel?: string | number;
  onBack: () => void;
  onHelp?: () => void;
  onOpenGallery?: () => void;
  onOpenCredits?: () => void;
  onLogin?: () => void;
};

/**
 * Mobile customizer shell — SCAFFOLD (checkpoint 1).
 *
 * Presentation-only chrome that wraps the EXISTING `EmbedDesign` tree below the
 * mobile breakpoint. It holds NO customizer state of its own: every value comes
 * in via props from `EmbedDesign`, and the product preview is the SAME in-place
 * preview column node (marked `.appai-mobile-canvas`) — reused, never duplicated
 * or forked. Desktop is untouched because `EmbedDesign` only mounts this (and the
 * gated class hooks) when `useIsMobile()` is true.
 *
 * Later checkpoints add the canvas-first layout (retractable rails + bottom bar),
 * bottom sheets, gestures, and requirements A–F. This file intentionally renders
 * just the top bar so the foundation (branch + shared state + build) can be
 * verified before more is built on top of it.
 */
export function MobileCustomizerShell({
  brandName = "AI Art Studio",
  isLoggedIn,
  creditsLabel,
  onBack,
  onHelp,
  onOpenGallery,
  onOpenCredits,
  onLogin,
}: MobileCustomizerShellProps) {
  return (
    <div className="appai-mshell-topbar" data-testid="mobile-shell-topbar">
      <button
        type="button"
        className="appai-mshell-iconbtn"
        aria-label="Back"
        onClick={onBack}
        data-testid="button-mobile-back"
      >
        <ChevronLeft />
      </button>

      <div className="appai-mshell-brand">
        <span className="appai-mshell-dot" />
        {brandName}
      </div>

      <button
        type="button"
        className="appai-mshell-iconbtn"
        aria-label="Help"
        onClick={onHelp}
        data-testid="button-mobile-help"
      >
        <HelpCircle />
      </button>

      <button
        type="button"
        className="appai-mshell-iconbtn"
        aria-label="My designs"
        onClick={onOpenGallery}
        data-testid="button-mobile-gallery"
      >
        <LayoutGrid />
      </button>

      {isLoggedIn ? (
        <button
          type="button"
          className="appai-mshell-credits"
          onClick={onOpenCredits}
          data-testid="button-mobile-credits"
        >
          <span className="appai-mshell-coin">&#9670;</span>
          {creditsLabel ?? 0}
        </button>
      ) : (
        <button
          type="button"
          className="appai-mshell-iconbtn"
          aria-label="Sign in"
          onClick={onLogin}
          data-testid="button-mobile-login"
        >
          <LogIn />
        </button>
      )}
    </div>
  );
}
