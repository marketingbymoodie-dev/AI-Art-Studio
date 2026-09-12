import "./mobile-customizer.css";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, HelpCircle, LayoutGrid, LogIn, X } from "lucide-react";

/**
 * One retractable-bar tool + its bottom sheet.
 *
 * `content` is a control node that lives in `EmbedDesign` (the SAME element the
 * desktop form column would render — see the `m*Node` consts). When `content`
 * is null/undefined the tool button and its sheet are not rendered, so the bar
 * only shows tools that actually apply to the current product.
 */
export type MobileSheetSlot = {
  id: string;
  label: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  content: ReactNode;
  /** Amber dot on the tool — e.g. "size still required". */
  needsAttention?: boolean;
};

export type MobileCustomizerShellProps = {
  brandName?: string;
  isLoggedIn: boolean;
  creditsLabel?: string | number;
  onBack: () => void;
  /** Always leaves the customizer for the shop homepage. */
  onHome?: () => void;
  onHelp?: () => void;
  onOpenGallery?: () => void;
  onOpenCredits?: () => void;
  onLogin?: () => void;

  /** Right-rail tools (Size / Layout / Colour / Info). */
  railSlots?: MobileSheetSlot[];
  /** Bottom-bar tools (Style / Background / Adjust / Options / Prompt). */
  bottomSlots?: MobileSheetSlot[];
  /** Reused primary action (renderPrimaryAction) — Generate / Add to Cart. */
  primaryAction?: ReactNode;
  /** Under-canvas "Place on item | Pattern" segmented control (AOP products). */
  showModeToggle?: boolean;
  mode?: "place" | "pattern";
  onModeChange?: (mode: "place" | "pattern") => void;
  /** Open this sheet when `nonce` changes (e.g. Pattern → Adjust). */
  openSheetRequest?: { id: string; nonce: number } | null;
};

/**
 * Mobile customizer shell — canvas-first layout (Checkpoint 2).
 *
 * This is presentation chrome only. It holds NO customizer state: every control
 * comes in via `railSlots` / `bottomSlots` as the SAME element objects the
 * desktop form column renders (one instance per session, reused — never a
 * mobile re-implementation). The product preview is the separate in-place
 * `.appai-mobile-canvas` node, CSS-fixed full-screen behind this chrome (it is
 * never moved in the React tree, so refs / ResizeObservers / mockup effects stay
 * intact). Only the sheet-open / bar-retracted UI state is local here.
 *
 * Desktop is untouched: `EmbedDesign` only mounts this (and gates its form
 * column) when `useIsMobile()` is true.
 */
export function MobileCustomizerShell({
  brandName = "AI Art Studio",
  isLoggedIn,
  creditsLabel,
  onBack,
  onHome,
  onHelp,
  onOpenGallery,
  onOpenCredits,
  onLogin,
  railSlots = [],
  bottomSlots = [],
  primaryAction,
  showModeToggle = false,
  mode = "place",
  onModeChange,
  openSheetRequest,
}: MobileCustomizerShellProps) {
  const rail = railSlots.filter((s) => s.content != null && s.content !== false);
  const bottom = bottomSlots.filter((s) => s.content != null && s.content !== false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [bottomTucked, setBottomTucked] = useState(false);
  const lastSheetRequestNonce = useRef(0);
  useLayoutEffect(() => {
    if (!openSheetRequest?.id) return;
    if (openSheetRequest.nonce === lastSheetRequestNonce.current) return;
    lastSheetRequestNonce.current = openSheetRequest.nonce;
    setOpenId(openSheetRequest.id);
    setBottomTucked(false);
  }, [openSheetRequest]);
  useLayoutEffect(() => {
    if (showModeToggle) return;
    setOpenId((cur) => (cur === "adjust" ? null : cur));
  }, [showModeToggle]);
  const [railTucked, setRailTucked] = useState(false);
  const activeMode = mode;
  const selectMode = useCallback(
    (m: "place" | "pattern") => {
      onModeChange?.(m);
    },
    [onModeChange],
  );

  const blurActive = useCallback(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && typeof el.blur === "function") el.blur();
  }, []);

  const closeSheet = useCallback(() => {
    setOpenId(null);
    blurActive();
  }, [blurActive]);

  // tap the same tool again → close; otherwise open it (single sheet at a time)
  const toggleSheet = useCallback((id: string) => {
    setOpenId((cur) => {
      if (cur === id) {
        blurActive();
        return null;
      }
      return id;
    });
  }, [blurActive]);

  const allSlots = [...rail, ...bottom];
  const activeSlot = allSlots.find((s) => s.id === openId) || null;
  const bothTucked = bottomTucked && railTucked;

  const modebarRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLDivElement | null>(null);
  const bottombarRef = useRef<HTMLDivElement | null>(null);

  // Measure the real chrome stack so canvas / modebar / primary never share
  // pixels. `renderPrimaryAction` can grow (terms, ATC extras) past the
  // 60px CSS budget — that was the AOP "Apply Pattern on top of Place/Pattern"
  // collision.
  useLayoutEffect(() => {
    const root = document.querySelector(".appai-mobile-shell") as HTMLElement | null;
    if (!root) return;
    const sync = () => {
      const modeH = showModeToggle && !bottomTucked ? modebarRef.current?.offsetHeight ?? 0 : 0;
      const primaryH = primaryRef.current?.offsetHeight ?? 0;
      const bottomH = bottomTucked ? 0 : bottombarRef.current?.offsetHeight ?? 0;
      root.style.setProperty("--appai-mobile-modebar-h", `${modeH}px`);
      root.style.setProperty("--appai-mobile-primary-h", `${Math.max(primaryH, 0)}px`);
      root.style.setProperty("--appai-mobile-bottombar-h", `${bottomH}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (modebarRef.current) ro.observe(modebarRef.current);
    if (primaryRef.current) ro.observe(primaryRef.current);
    if (bottombarRef.current) ro.observe(bottombarRef.current);
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, [showModeToggle, bottomTucked, rail.length, bottom.length]);

  return (
    <>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
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

        <button
          type="button"
          className="appai-mshell-brand"
          aria-label="Home"
          onClick={onHome ?? onBack}
          data-testid="button-mobile-home"
        >
          <span className="appai-mshell-dot" />
          {brandName}
        </button>

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

      {/* ── Right rail (retractable) ────────────────────────────────────── */}
      {rail.length > 0 && (
        <div
          className={`appai-mrail${railTucked ? " tucked" : ""}`}
          data-testid="mobile-rail"
        >
          <button
            type="button"
            className="appai-mrail-tab"
            aria-label={railTucked ? "Show options" : "Hide options"}
            onClick={() => setRailTucked((v) => !v)}
            data-testid="button-mobile-rail-tab"
          />
          <div className="appai-mrail-col">
            {rail.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`appai-mrtool${openId === s.id ? " active" : ""}${
                  s.needsAttention ? " need" : ""
                }`}
                onClick={() => toggleSheet(s.id)}
                data-testid={`button-mobile-rtool-${s.id}`}
              >
                <span className="appai-mrtool-ico">{s.icon}</span>
                <span className="appai-mrtool-lbl">{s.label}</span>
                {s.needsAttention ? <span className="appai-mrtool-badge" /> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Under-canvas mode toggle (AOP) ──────────────────────────────── */}
      {showModeToggle && (
        <div ref={modebarRef} className="appai-mmodebar" data-testid="mobile-modebar">
          <button
            type="button"
            className={`appai-mseg${activeMode === "place" ? " sel" : ""}`}
            onClick={() => selectMode("place")}
            data-testid="button-mobile-mode-place"
          >
            Place on item
          </button>
          <button
            type="button"
            className={`appai-mseg${activeMode === "pattern" ? " sel" : ""}`}
            onClick={() => selectMode("pattern")}
            data-testid="button-mobile-mode-pattern"
          >
            Pattern
          </button>
        </div>
      )}

      {/* ── Primary action row (Generate / Add to Cart) ─────────────────── */}
      {primaryAction ? (
        <div ref={primaryRef} className="appai-mprimary" data-testid="mobile-primary">
          {primaryAction}
        </div>
      ) : null}

      {/* ── Bottom bar (retractable) ────────────────────────────────────── */}
      {bottom.length > 0 && (
        <div
          ref={bottombarRef}
          className={`appai-mbottombar${bottomTucked ? " tucked" : ""}`}
          data-testid="mobile-bottombar"
        >
          <button
            type="button"
            className="appai-mbottom-pull"
            aria-label={bottomTucked ? "Show tools" : "Hide tools"}
            onClick={() => setBottomTucked((v) => !v)}
            data-testid="button-mobile-bottom-pull"
          />
          <div className="appai-mtools">
            {bottom.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`appai-mtool${openId === s.id ? " active" : ""}`}
                onClick={() => toggleSheet(s.id)}
                data-testid={`button-mobile-tool-${s.id}`}
              >
                <span className="appai-mtool-ico">{s.icon}</span>
                <span className="appai-mtool-lbl">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Both bars hidden — keep the customer oriented. */}
      {bothTucked ? (
        <div className="appai-mfs-hint" data-testid="mobile-fs-hint">
          Bars hidden — tap the edge tabs to bring them back
        </div>
      ) : null}

      {/* ── Scrim + sheets ──────────────────────────────────────────────── */}
      <div
        className={`appai-mscrim${activeSlot ? " show" : ""}`}
        onClick={closeSheet}
        data-testid="mobile-scrim"
        aria-hidden={!activeSlot}
      />

      {allSlots.map((s) => (
        <MobileSheet
          key={s.id}
          slot={s}
          open={openId === s.id}
          onClose={closeSheet}
        />
      ))}
    </>
  );
}

/** One bottom sheet: grab handle (tap / drag-down to close), X, title, body. */
function MobileSheet({
  slot,
  open,
  onClose,
}: {
  slot: MobileSheetSlot;
  open: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; moved: boolean } | null>(null);

  const onGrabDown = useCallback((e: React.PointerEvent) => {
    const el = sheetRef.current;
    if (!el) return;
    drag.current = { startY: e.clientY, moved: false };
    el.style.transition = "none";
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }, []);

  const onGrabMove = useCallback((e: React.PointerEvent) => {
    const el = sheetRef.current;
    if (!el || !drag.current) return;
    const dy = e.clientY - drag.current.startY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    el.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, []);

  const onGrabUp = useCallback(
    (e: React.PointerEvent) => {
      const el = sheetRef.current;
      if (!el || !drag.current) return;
      const dy = e.clientY - drag.current.startY;
      const { moved } = drag.current;
      drag.current = null;
      el.style.transition = "";
      el.style.transform = "";
      // tap (no move) OR a downward fling both dismiss
      if (!moved || dy > 70) onClose();
    },
    [onClose],
  );

  return (
    <div
      ref={sheetRef}
      className={`appai-msheet${open ? " show" : ""}`}
      data-panel={slot.id}
      data-testid={`mobile-sheet-${slot.id}`}
      aria-hidden={!open}
    >
      <div
        className="appai-msheet-grab"
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        data-testid={`mobile-sheet-grab-${slot.id}`}
      />
      <button
        type="button"
        className="appai-msheet-x"
        aria-label="Close"
        onClick={onClose}
        data-testid={`button-mobile-sheet-close-${slot.id}`}
      >
        <X />
      </button>
      <h3 className="appai-msheet-title">{slot.title}</h3>
      {slot.subtitle ? <p className="appai-msheet-sub">{slot.subtitle}</p> : null}
      {/* Always mounted (hidden via transform when closed) so the reused control
          instances keep their place in the tree — no remount on open/close. */}
      <div className="appai-msheet-body">{slot.content}</div>
    </div>
  );
}
