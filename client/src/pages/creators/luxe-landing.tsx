import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LANDING_CONTENT, type LandingContent } from "@shared/landingContent";
import { LastCreatorReturnButton } from "@/components/creators/LastCreatorReturnButton";
import { StudioNewsletterSignup } from "@/components/studio-newsletter-signup";

const FALLBACK_ART = [
  "radial-gradient(circle at 40% 35%, #ff8a4a, transparent 34%), radial-gradient(circle at 70% 60%, #5b8cff, transparent 36%), #2a2030",
  "linear-gradient(135deg, #1b3dff, #d946ef 55%, #111)",
  "radial-gradient(circle at 50% 30%, #f3d27a, transparent 28%), linear-gradient(#2a2018, #0e0c0a)",
  "radial-gradient(circle at 30% 40%, #7c3aed, transparent 32%), radial-gradient(circle at 70% 70%, #22d3ee, transparent 30%), #120818",
  "radial-gradient(circle at 60% 40%, #d946ef 0 16%, transparent 17%), #161018",
];

export default function LuxeLandingPage() {
  const [, setLocation] = useLocation();
  const { data } = useQuery<{ content: LandingContent }>({
    queryKey: ["/api/creators/landing"],
  });
  const content = data?.content ?? DEFAULT_LANDING_CONTENT;
  const [view, setView] = useState<"splash" | "landing">("splash");

  return (
    <div className="luxe-root min-h-svh text-[#f5f5f7]">
      <style>{LUXE_CSS}</style>
      {view === "splash" ? (
        <Splash content={content} onMore={() => setView("landing")} />
      ) : (
        <Landing content={content} onApply={(track) => setLocation(`/creators/apply?track=${track}`)} />
      )}
    </div>
  );
}

/** Fastest type delay (current production speed). Higher delay = slower typing. */
const TYPE_DELAY_FAST_MS = 38;
const TYPE_DELAY_SLOW_MS = 152;
const TYPE_DELAY_DEFAULT_MS = 76; // half of the original 38ms tick

function Splash({ content, onMore }: { content: LandingContent; onMore: () => void }) {
  const scenes = content.scenes;
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState(0);
  const [typeDelayMs, setTypeDelayMs] = useState(TYPE_DELAY_DEFAULT_MS);

  useEffect(() => {
    if (!scenes.length) return;
    const scene = scenes[index];
    let char = 0;
    setTyped("");
    setProgress(0);
    const tick = window.setInterval(() => {
      char += 1;
      setTyped(scene.prompt.slice(0, char));
      setProgress(char / Math.max(scene.prompt.length, 1));
      if (char >= scene.prompt.length) {
        window.clearInterval(tick);
        window.setTimeout(() => setIndex((i) => (i + 1) % scenes.length), 1600);
      }
    }, typeDelayMs);
    return () => window.clearInterval(tick);
  }, [index, scenes, typeDelayMs]);

  const scene = scenes[index] ?? scenes[0];
  if (!scene) return null;

  return (
    <section className="luxe-page text-center pt-[8vh] px-6 pb-16">
      <p className="luxe-eyebrow">{content.copy.splashEyebrow}</p>
      <h1 className="luxe-h1">{content.copy.splashTitle}</h1>
      <div className="luxe-window mx-auto mt-8">
        <div className="luxe-scene">
          <div className="luxe-bubble">
            <div className="luxe-who">Prompt</div>
            <div className="luxe-prompt">
              {typed}
              <span className="luxe-caret" />
            </div>
          </div>
          <div className="luxe-product">
            <div
              className="luxe-art"
              style={{
                opacity: Math.min(1, progress * 1.15),
                transform: `scale(${0.96 + progress * 0.04})`,
                background: scene.imageUrl ? undefined : FALLBACK_ART[index % FALLBACK_ART.length],
                backgroundImage: scene.imageUrl ? `url(${scene.imageUrl})` : undefined,
              }}
            />
          </div>
        </div>
      </div>
      <p className="luxe-caption mt-5">{content.copy.splashCaption}</p>
      <label className="luxe-type-speed">
        <span>Type speed</span>
        <input
          type="range"
          min={TYPE_DELAY_FAST_MS}
          max={TYPE_DELAY_SLOW_MS}
          step={2}
          value={typeDelayMs}
          onChange={(e) => setTypeDelayMs(Number(e.target.value))}
          aria-label="Prompt type speed"
        />
        <span className="luxe-type-speed-ends">
          <em>Fast</em>
          <em>Slow</em>
        </span>
      </label>
      <div className="mt-8 flex flex-col items-center gap-3">
        <button type="button" className="luxe-btn-white" onClick={onMore}>
          {content.copy.splashCta}
        </button>
        <LastCreatorReturnButton variant="luxe" />
      </div>
    </section>
  );
}

function Landing({
  content,
  onApply,
}: {
  content: LandingContent;
  onApply: (track: "creator" | "shopify") => void;
}) {
  const cards = content.cards;
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);

  const go = (next: number) => setIndex(Math.max(0, Math.min(cards.length - 1, next)));

  const stepFromPointer = (el: HTMLDivElement, clientX: number, start: number) => {
    const dx = clientX - start;
    if (dx > 40) return go(index - 1);
    if (dx < -40) return go(index + 1);
    const rect = el.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    const dead = rect.width * 0.16;
    if (clientX < mid - dead) go(index - 1);
    else if (clientX > mid + dead) go(index + 1);
  };

  const cta = (
    <div className="luxe-cta">
      <button type="button" className="luxe-btn-white" onClick={() => onApply("creator")}>
        {content.copy.ctaCreator}
      </button>
      <button type="button" className="luxe-btn-ghost" onClick={() => onApply("shopify")}>
        {content.copy.ctaShopify}
      </button>
    </div>
  );

  const flow = (
    <div className="luxe-stage">
      <div
        className="luxe-flow"
        onPointerDown={(e) => {
          startX.current = e.clientX;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (startX.current == null) return;
          stepFromPointer(e.currentTarget as HTMLDivElement, e.clientX, startX.current);
          startX.current = null;
        }}
      >
        <div className="luxe-deck">
          {cards.map((card, i) => {
            const offset = i - index;
            const abs = Math.abs(offset);
            return (
              <article
                key={card.id}
                className="luxe-album"
                style={{
                  transform: `translate(-50%, -50%) translateX(${offset * 36}%) translateZ(${-abs * 140}px) rotateY(${offset * -26}deg) scale(${1 - abs * 0.08})`,
                  opacity: abs > 2 ? 0 : 1 - abs * 0.18,
                  zIndex: 20 - abs,
                }}
              >
                <div
                  className="luxe-thumb"
                  style={{
                    background: card.imageUrl ? undefined : FALLBACK_ART[i % FALLBACK_ART.length],
                    backgroundImage: card.imageUrl ? `url(${card.imageUrl})` : undefined,
                  }}
                />
                <h2>{card.title}</h2>
                <p>{card.body}</p>
              </article>
            );
          })}
        </div>
      </div>
      <div className="flex justify-center gap-2">
        {cards.map((card, i) => (
          <button
            key={card.id}
            type="button"
            className={`luxe-dot ${i === index ? "is-on" : ""}`}
            onClick={() => go(i)}
            aria-label={`Show ${card.title}`}
          />
        ))}
      </div>
    </div>
  );

  return (
    <section className="luxe-page luxe-landing">
      <div className="luxe-landing-grid">
        <div className="luxe-landing-copy">
          <StackedHeadline text={content.copy.landingHeadline} />
          <p className="luxe-lede">{content.copy.landingLede}</p>
          <div className="luxe-cta-desktop">
            <p className="luxe-eyebrow">{content.copy.landingEyebrow}</p>
            {cta}
            <div className="mt-3">
              <LastCreatorReturnButton variant="luxe" />
            </div>
          </div>
        </div>
        <div className="luxe-landing-bottom">
          {flow}
          <div className="luxe-cta-mobile">
            <p className="luxe-eyebrow">{content.copy.landingEyebrow}</p>
            {cta}
          </div>
        </div>
      </div>
      <LandingKeys onLeft={() => go(index - 1)} onRight={() => go(index + 1)} />
      <div className="mx-auto mt-8 max-w-md">
        <StudioNewsletterSignup source="creator" variant="luxe" />
      </div>
      <p className="luxe-portal">
        <Link href="/portal/login" className="underline underline-offset-2">
          Creator Portal
        </Link>
        {" · "}
        <a href="/terms" className="underline underline-offset-2">
          Terms
        </a>
        {" · "}
        <a href="/privacy" className="underline underline-offset-2">
          Privacy
        </a>
      </p>
    </section>
  );
}

function StackedHeadline({ text }: { text: string }) {
  const parts = text.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return <h1 className="luxe-h1">{text}</h1>;
  return (
    <h1 className="luxe-h1">
      {parts.map((part, i) => (
        <span key={i} className="block">
          {part}
          {i < parts.length - 1 ? "," : ""}
        </span>
      ))}
    </h1>
  );
}

function LandingKeys({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") onLeft();
      if (e.key === "ArrowRight") onRight();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeft, onRight]);
  return null;
}

const LUXE_CSS = `
  .luxe-root {
    background:
      radial-gradient(ellipse at 50% 0%, rgba(90, 70, 180, 0.22), transparent 52%),
      radial-gradient(ellipse at 80% 80%, rgba(20, 80, 120, 0.18), transparent 45%),
      #07070b;
    font-family: Inter, system-ui, sans-serif;
  }
  .luxe-page { max-width: min(1440px, 94vw); margin: 0 auto; }
  .luxe-landing {
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 24px 28px 18px;
    box-sizing: border-box;
  }
  .luxe-landing-grid { display: grid; gap: 20px; align-items: center; }
  .luxe-landing-copy { position: relative; z-index: 2; }
  .luxe-cta { display: flex; flex-wrap: wrap; gap: 12px; }
  .luxe-cta-mobile { display: none; }
  .luxe-cta-desktop { display: block; margin-top: 22px; }
  .luxe-cta-desktop .luxe-eyebrow,
  .luxe-cta-mobile .luxe-eyebrow { margin-bottom: 12px; }
  .luxe-eyebrow { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(245,245,247,0.62); }
  .luxe-h1 { margin: 0; font-size: clamp(32px, 4.2vw, 58px); line-height: 0.98; letter-spacing: -0.04em; font-weight: 800; }
  .luxe-lede { margin: 14px 0 0; max-width: 36rem; color: rgba(245,245,247,0.62); font-size: 16px; line-height: 1.45; }
  .luxe-caption { letter-spacing: 0.08em; text-transform: uppercase; color: rgba(245,245,247,0.62); font-size: 14px; }
  .luxe-type-speed {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    width: min(220px, 70vw);
    margin: 18px auto 0;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(245,245,247,0.55);
  }
  .luxe-type-speed input[type="range"] {
    width: 100%;
    accent-color: #fff;
    cursor: pointer;
  }
  .luxe-type-speed-ends {
    display: flex;
    justify-content: space-between;
    font-style: normal;
    letter-spacing: 0.12em;
    color: rgba(245,245,247,0.4);
  }
  .luxe-type-speed-ends em { font-style: normal; }
  .luxe-portal { text-align: center; font-size: 11px; color: rgba(255,255,255,0.35); margin: 10px 0 0; }
  .luxe-btn-white, .luxe-btn-ghost {
    border-radius: 999px; padding: 12px 22px; cursor: pointer; letter-spacing: 0.06em;
    text-transform: uppercase; font-size: 11px; font-weight: 700;
  }
  .luxe-btn-white { border: 0; background: #fff; color: #111; box-shadow: 0 0 28px rgba(190, 150, 255, 0.55); }
  .luxe-btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.55); }
  .luxe-btn-return { text-transform: none; letter-spacing: 0.02em; font-size: 12px; }
  .luxe-window {
    width: min(860px, 94vw); border-radius: 28px; border: 1px solid rgba(255,255,255,0.12);
    background: #0c0c12; box-shadow: 0 0 80px rgba(90, 140, 255, 0.2); overflow: hidden;
  }
  .luxe-scene { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 20px; align-items: center; padding: 28px; min-height: 360px; }
  @media (max-width: 720px) { .luxe-scene { grid-template-columns: 1fr; min-height: 520px; } }
  .luxe-bubble { position: relative; text-align: left; background: #16161f; border: 1px solid rgba(255,255,255,0.12); border-radius: 22px; padding: 18px 20px 20px; min-height: 160px; }
  .luxe-who { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(245,245,247,0.62); margin-bottom: 10px; }
  .luxe-prompt { font-size: 22px; line-height: 1.35; letter-spacing: -0.02em; min-height: 4.2em; text-align: left; }
  .luxe-caret { display: inline-block; width: 2px; height: 1em; background: #fff; margin-left: 2px; vertical-align: -2px; animation: luxe-blink 1s step-end infinite; }
  @keyframes luxe-blink { 50% { opacity: 0; } }
  .luxe-product { display: grid; place-items: center; }
  .luxe-art {
    width: min(260px, 64vw); aspect-ratio: 1; border-radius: 18px; border: 1px solid rgba(255,255,255,0.1);
    background-size: cover; background-position: center; background-color: #14141c;
  }
  .luxe-stage { min-width: 0; overflow: hidden; }
  .luxe-flow { perspective: 1200px; margin: 0 0 10px; height: min(420px, 58vh); user-select: none; touch-action: pan-y; cursor: pointer; }
  .luxe-deck { position: relative; height: 100%; transform-style: preserve-3d; pointer-events: none; }
  .luxe-album {
    position: absolute; top: 50%; left: 50%; width: min(400px, 28vw); height: auto;
    border-radius: 20px;
    background: linear-gradient(180deg, #16161f, #0b0b10); border: 1px solid rgba(255,255,255,0.16);
    box-shadow: 0 20px 60px rgba(0,0,0,0.45); padding: 14px;
    transition: transform 420ms cubic-bezier(.2,.8,.2,1), opacity 420ms ease;
  }
  .luxe-album h2 { margin: 12px 0 6px; font-size: 22px; letter-spacing: -0.03em; }
  .luxe-album p { margin: 0; color: rgba(245,245,247,0.62); line-height: 1.4; font-size: 14px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .luxe-thumb {
    width: 100%; aspect-ratio: 16 / 9; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.1); background-color: #0a0a10;
    background-size: contain; background-repeat: no-repeat; background-position: center;
  }
  .luxe-dot { width: 7px; height: 7px; border-radius: 99px; border: 0; padding: 0; background: rgba(255,255,255,0.22); cursor: pointer; }
  .luxe-dot.is-on { background: #fff; width: 22px; }
  @media (min-width: 960px) {
    .luxe-landing-grid { grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.05fr); gap: 28px 32px; }
  }
  @media (min-width: 1400px) {
    .luxe-album { width: min(440px, 26vw); }
    .luxe-flow { height: min(460px, 60vh); }
  }
  @media (max-width: 959px) {
    .luxe-landing { padding: 16px 16px 12px; justify-content: flex-start; }
    .luxe-landing-grid { flex: 1; grid-template-rows: auto 1fr; gap: 12px; }
    .luxe-landing-copy { text-align: center; }
    .luxe-h1 { font-size: clamp(28px, 8.2vw, 40px); }
    .luxe-lede { display: none; }
    .luxe-cta-desktop { display: none; }
    .luxe-cta-mobile { display: block; margin-top: 12px; }
    .luxe-cta { flex-direction: column; }
    .luxe-cta button { width: 100%; }
    .luxe-landing-bottom { display: flex; flex-direction: column; min-height: 0; }
    .luxe-flow { height: min(320px, 46svh); }
    .luxe-album { width: min(300px, 78vw); padding: 12px; }
    .luxe-album h2 { font-size: 18px; }
    .luxe-album p { font-size: 13px; -webkit-line-clamp: 2; }
    .luxe-portal { display: none; }
  }
`;
