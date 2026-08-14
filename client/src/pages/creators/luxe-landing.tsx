import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LANDING_CONTENT, type LandingContent } from "@shared/landingContent";

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
    <div className="luxe-root min-h-screen text-[#f5f5f7]">
      <style>{LUXE_CSS}</style>
      {view === "splash" ? (
        <Splash content={content} onMore={() => setView("landing")} />
      ) : (
        <Landing content={content} onApply={(track) => setLocation(`/creators/apply?track=${track}`)} />
      )}
    </div>
  );
}

function Splash({ content, onMore }: { content: LandingContent; onMore: () => void }) {
  const scenes = content.scenes;
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState(0);

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
    }, 38);
    return () => window.clearInterval(tick);
  }, [index, scenes]);

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
      <div className="mt-8">
        <button type="button" className="luxe-btn-white" onClick={onMore}>
          {content.copy.splashCta}
        </button>
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

  return (
    <section className="luxe-page px-6 py-14">
      <p className="luxe-eyebrow">{content.copy.landingEyebrow}</p>
      <h1 className="luxe-h1 max-w-4xl">{content.copy.landingHeadline}</h1>
      <p className="luxe-lede">{content.copy.landingLede}</p>
      <div className="flex flex-wrap gap-3 mt-8 mb-2">
        <button type="button" className="luxe-btn-white" onClick={() => onApply("creator")}>
          {content.copy.ctaCreator}
        </button>
        <button type="button" className="luxe-btn-ghost" onClick={() => onApply("shopify")}>
          {content.copy.ctaShopify}
        </button>
      </div>
      <div
        className="luxe-flow"
        onPointerDown={(e) => {
          startX.current = e.clientX;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          if (startX.current == null) return;
          const dx = e.clientX - startX.current;
          if (dx > 40) go(index - 1);
          if (dx < -40) go(index + 1);
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
                  transform: `translateX(${offset * 42}%) translateZ(${-abs * 140}px) rotateY(${offset * -32}deg) scale(${1 - abs * 0.08})`,
                  opacity: abs > 2 ? 0 : 1 - abs * 0.18,
                  zIndex: 20 - abs,
                  pointerEvents: abs > 2 ? "none" : "auto",
                }}
                onClick={() => go(i)}
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
      <div className="flex justify-center gap-2 mt-2">
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
      <p className="text-center text-sm text-white/50 mt-3">
        Drag, swipe, click a side card, or use arrow keys
      </p>
      <LandingKeys onLeft={() => go(index - 1)} onRight={() => go(index + 1)} />
      <p className="text-center text-xs text-white/35 mt-10">
        <Link href="/portal/login" className="underline underline-offset-2">
          Creator Portal
        </Link>
      </p>
    </section>
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
  .luxe-page { max-width: 1120px; margin: 0 auto; }
  .luxe-eyebrow { margin: 0 0 12px; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(245,245,247,0.62); }
  .luxe-h1 { margin: 0; font-size: clamp(34px, 6vw, 72px); line-height: 0.96; letter-spacing: -0.04em; font-weight: 800; }
  .luxe-lede { margin: 18px 0 0; max-width: 40rem; color: rgba(245,245,247,0.62); font-size: 18px; line-height: 1.5; }
  .luxe-caption { letter-spacing: 0.08em; text-transform: uppercase; color: rgba(245,245,247,0.62); font-size: 14px; }
  .luxe-btn-white, .luxe-btn-ghost {
    border-radius: 999px; padding: 14px 26px; cursor: pointer; letter-spacing: 0.06em;
    text-transform: uppercase; font-size: 12px; font-weight: 700;
  }
  .luxe-btn-white { border: 0; background: #fff; color: #111; box-shadow: 0 0 28px rgba(190, 150, 255, 0.55); }
  .luxe-btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.55); }
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
  .luxe-flow { perspective: 1400px; margin: 36px 0 16px; height: 420px; user-select: none; touch-action: pan-y; }
  .luxe-deck { position: relative; height: 100%; transform-style: preserve-3d; }
  .luxe-album {
    position: absolute; inset: 0; width: min(420px, 78vw); height: 400px; left: 50%;
    margin-left: calc(min(420px, 78vw) / -2); border-radius: 22px;
    background: linear-gradient(180deg, #16161f, #0b0b10); border: 1px solid rgba(255,255,255,0.16);
    box-shadow: 0 20px 60px rgba(0,0,0,0.45); padding: 22px;
    transition: transform 420ms cubic-bezier(.2,.8,.2,1), opacity 420ms ease; cursor: pointer;
  }
  .luxe-album h2 { margin: 18px 0 8px; font-size: 28px; letter-spacing: -0.03em; }
  .luxe-album p { margin: 0; color: rgba(245,245,247,0.62); line-height: 1.45; }
  .luxe-thumb { height: 190px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); background-size: cover; background-position: center; }
  .luxe-dot { width: 7px; height: 7px; border-radius: 99px; border: 0; padding: 0; background: rgba(255,255,255,0.22); cursor: pointer; }
  .luxe-dot.is-on { background: #fff; width: 22px; }
`;
