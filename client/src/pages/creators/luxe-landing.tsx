import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  clampLandingAutoMs,
  clampLandingTypeDelayMs,
  DEFAULT_LANDING_CONTENT,
  LANDING_GALLERY_AUTO_DEFAULT_MS,
  LANDING_HERO_AUTO_DEFAULT_MS,
  type LandingContent,
} from "@shared/landingContent";
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
  const { data, isFetched } = useQuery<{ content: LandingContent }>({
    queryKey: ["/api/creators/landing"],
  });
  // Wait for saved landing copy — defaults flash the old placeholder prompts.
  const content = isFetched ? (data?.content ?? DEFAULT_LANDING_CONTENT) : null;
  const [view, setView] = useState<"landing" | "gallery">("landing");

  return (
    <div className="luxe-root min-h-svh text-[#f5f5f7]">
      <style>{LUXE_CSS}</style>
      {!content ? null : view === "gallery" ? (
        <Gallery
          content={content}
          onApply={() => setLocation("/creators/apply?track=creator")}
          onBack={() => setView("landing")}
        />
      ) : (
        <Landing
          content={content}
          onApply={(track) => setLocation(`/creators/apply?track=${track}`)}
          onGallery={() => setView("gallery")}
        />
      )}
    </div>
  );
}

function useDeckPager(count: number, autoMs: number) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const startX = useRef<number | null>(null);

  const wrap = (next: number) => {
    if (count <= 0) return 0;
    return ((next % count) + count) % count;
  };
  const go = (next: number) => setIndex(wrap(next));

  useEffect(() => {
    if (hovered || count < 2) return;
    const id = window.setInterval(() => setIndex((i) => wrap(i + 1)), autoMs);
    return () => window.clearInterval(id);
  }, [hovered, count, autoMs, index]);

  const pointer = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      startX.current = e.clientX;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      if (startX.current == null) return;
      const dx = e.clientX - startX.current;
      const clientX = e.clientX;
      const el = e.currentTarget;
      startX.current = null;
      if (dx > 40) return go(index - 1);
      if (dx < -40) return go(index + 1);
      const rect = el.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      const dead = rect.width * 0.16;
      if (clientX < mid - dead) go(index - 1);
      else if (clientX > mid + dead) go(index + 1);
    },
  };

  return { index, go, pointer };
}

function Landing({
  content,
  onApply,
  onGallery,
}: {
  content: LandingContent;
  onApply: (track: "creator" | "shopify") => void;
  onGallery: () => void;
}) {
  const cards = content.cards;
  const autoMs = clampLandingAutoMs(content.heroAutoMs, LANDING_HERO_AUTO_DEFAULT_MS);
  const { index, go, pointer } = useDeckPager(cards.length, autoMs);

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

  const artClass = (
    <div className="luxe-art-class">
      <StudioNewsletterSignup source="creator" variant="luxe" />
    </div>
  );

  const flow = (
    <div className="luxe-stage">
      <div className="luxe-flow" {...pointer}>
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
      <button type="button" className="luxe-btn-white luxe-btn-gallery" onClick={onGallery}>
        {content.copy.galleryCta}
      </button>
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
            {artClass}
          </div>
        </div>
        <div className="luxe-landing-bottom">
          {flow}
          <div className="luxe-cta-mobile">
            <p className="luxe-eyebrow">{content.copy.landingEyebrow}</p>
            {cta}
            {artClass}
          </div>
        </div>
      </div>
      <LandingKeys onLeft={() => go(index - 1)} onRight={() => go(index + 1)} />
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

function Gallery({
  content,
  onApply,
  onBack,
}: {
  content: LandingContent;
  onApply: () => void;
  onBack: () => void;
}) {
  const scenes = content.scenes;
  const typeDelayMs = clampLandingTypeDelayMs(content.typeDelayMs);
  const autoMs = clampLandingAutoMs(content.galleryAutoMs, LANDING_GALLERY_AUTO_DEFAULT_MS);
  const { index, go, pointer } = useDeckPager(scenes.length, autoMs);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState(0);
  const copy = content.copy;

  useEffect(() => {
    const scene = scenes[index];
    if (!scene) return;
    let char = 0;
    setTyped("");
    setProgress(0);
    const tick = window.setInterval(() => {
      char += 1;
      setTyped(scene.prompt.slice(0, char));
      setProgress(char / Math.max(scene.prompt.length, 1));
      if (char >= scene.prompt.length) window.clearInterval(tick);
    }, typeDelayMs);
    return () => window.clearInterval(tick);
  }, [index, scenes, typeDelayMs]);

  return (
    <section className="luxe-page luxe-gallery">
      <h1 className="luxe-h1">{copy.splashTitle}</h1>
      <p className="luxe-slogan">{copy.splashCaption}</p>
      <div className="luxe-stage luxe-gallery-stage">
        <div className="luxe-flow luxe-flow-lg" {...pointer}>
          <div className="luxe-deck">
            {scenes.map((scene, i) => {
              const offset = i - index;
              const abs = Math.abs(offset);
              const active = i === index;
              return (
                <article
                  key={scene.id}
                  className="luxe-album luxe-album-lg"
                  style={{
                    transform: `translate(-50%, -50%) translateX(${offset * 28}%) translateZ(${-abs * 160}px) rotateY(${offset * -22}deg) scale(${1 - abs * 0.07})`,
                    opacity: abs > 2 ? 0 : 1 - abs * 0.16,
                    zIndex: 20 - abs,
                  }}
                >
                  <div className="luxe-gallery-pair">
                    <div
                      className="luxe-gallery-art"
                      style={{
                        opacity: active ? Math.min(1, progress * 1.15) : 0.72,
                        background: scene.imageUrl ? undefined : FALLBACK_ART[i % FALLBACK_ART.length],
                        backgroundImage: scene.imageUrl ? `url(${scene.imageUrl})` : undefined,
                      }}
                    />
                    <div className="luxe-gallery-prompt">
                      <div className="luxe-who">Prompt</div>
                      <div className="luxe-prompt">
                        {active ? typed : scene.prompt}
                        {active ? <span className="luxe-caret" /> : null}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <div className="flex justify-center gap-2">
          {scenes.map((scene, i) => (
            <button
              key={scene.id}
              type="button"
              className={`luxe-dot ${i === index ? "is-on" : ""}`}
              onClick={() => go(i)}
              aria-label={`Show prompt ${i + 1}`}
            />
          ))}
        </div>
      </div>
      <div className="luxe-cta luxe-gallery-cta">
        <button type="button" className="luxe-btn-white" onClick={onApply}>
          {copy.ctaCreator}
        </button>
        <button type="button" className="luxe-btn-ghost" onClick={onBack}>
          {copy.galleryBack}
        </button>
      </div>
      <LandingKeys onLeft={() => go(index - 1)} onRight={() => go(index + 1)} />
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
  .luxe-landing, .luxe-gallery {
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 24px 28px 18px;
    box-sizing: border-box;
  }
  .luxe-gallery { align-items: center; text-align: center; padding-top: 20px; padding-bottom: 16px; }
  .luxe-gallery .luxe-h1 { font-size: clamp(28px, 3.6vw, 48px); }
  .luxe-landing-grid { display: grid; gap: 20px; align-items: center; }
  .luxe-landing-copy { position: relative; z-index: 2; }
  .luxe-cta { display: flex; flex-wrap: wrap; gap: 12px; }
  .luxe-cta-mobile { display: none; }
  .luxe-cta-desktop { display: block; margin-top: 22px; }
  .luxe-cta-desktop .luxe-eyebrow,
  .luxe-cta-mobile .luxe-eyebrow { margin-bottom: 12px; }
  .luxe-art-class { margin-top: 22px; max-width: 28rem; }
  .luxe-eyebrow { margin: 0 0 10px; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(245,245,247,0.62); }
  .luxe-h1 { margin: 0; font-size: clamp(32px, 4.2vw, 58px); line-height: 0.98; letter-spacing: -0.04em; font-weight: 800; }
  .luxe-slogan {
    margin: 8px 0 0;
    font-size: clamp(20px, 2.4vw, 32px);
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-weight: 600;
    color: rgba(245,245,247,0.78);
  }
  .luxe-lede { margin: 14px 0 0; max-width: 36rem; color: rgba(245,245,247,0.62); font-size: 16px; line-height: 1.45; }
  .luxe-portal { text-align: center; font-size: 11px; color: rgba(255,255,255,0.35); margin: 10px 0 0; }
  .luxe-btn-white, .luxe-btn-ghost {
    border-radius: 999px; padding: 12px 22px; cursor: pointer; letter-spacing: 0.06em;
    text-transform: uppercase; font-size: 11px; font-weight: 700;
  }
  .luxe-btn-white { border: 0; background: #fff; color: #111; box-shadow: 0 0 28px rgba(190, 150, 255, 0.55); }
  .luxe-btn-ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.55); }
  .luxe-btn-return { text-transform: none; letter-spacing: 0.02em; font-size: 12px; }
  .luxe-btn-gallery {
    display: block; width: min(420px, 100%); margin: 18px auto 0; padding: 16px 28px; font-size: 13px;
  }
  .luxe-who { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(245,245,247,0.62); margin-bottom: 6px; }
  .luxe-prompt {
    font-size: 15px; line-height: 1.35; letter-spacing: -0.02em; text-align: left;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .luxe-caret { display: inline-block; width: 2px; height: 1em; background: #fff; margin-left: 2px; vertical-align: -2px; animation: luxe-blink 1s step-end infinite; }
  @keyframes luxe-blink { 50% { opacity: 0; } }
  .luxe-stage { min-width: 0; overflow: hidden; }
  .luxe-gallery-stage { width: 100%; margin-top: 16px; }
  .luxe-gallery-cta { justify-content: center; margin-top: 14px; }
  .luxe-flow { perspective: 1200px; margin: 0 0 10px; height: min(420px, 58vh); user-select: none; touch-action: pan-y; cursor: pointer; }
  .luxe-flow-lg { height: min(460px, 54vh); }
  .luxe-deck { position: relative; height: 100%; transform-style: preserve-3d; pointer-events: none; }
  .luxe-album {
    position: absolute; top: 50%; left: 50%; width: min(400px, 28vw); height: auto;
    border-radius: 20px;
    background: linear-gradient(180deg, #16161f, #0b0b10); border: 1px solid rgba(255,255,255,0.16);
    box-shadow: 0 20px 60px rgba(0,0,0,0.45); padding: 14px;
    transition: transform 420ms cubic-bezier(.2,.8,.2,1), opacity 420ms ease;
  }
  .luxe-album-lg { width: min(320px, 58vw); padding: 12px; }
  .luxe-album h2 { margin: 12px 0 6px; font-size: 22px; letter-spacing: -0.03em; }
  .luxe-album p { margin: 0; color: rgba(245,245,247,0.62); line-height: 1.4; font-size: 14px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .luxe-thumb {
    width: 100%; aspect-ratio: 16 / 9; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.1); background-color: #0a0a10;
    background-size: contain; background-repeat: no-repeat; background-position: center;
  }
  .luxe-gallery-pair { display: flex; flex-direction: column; gap: 10px; width: 100%; }
  .luxe-gallery-art {
    width: 100%; aspect-ratio: 1; flex: none;
    border-radius: 16px; border: 1px solid rgba(255,255,255,0.12);
    background-size: cover; background-position: center; background-color: #14141c;
    transition: opacity 320ms ease;
  }
  .luxe-gallery-prompt {
    width: 100%; height: 7.4rem; flex: none; box-sizing: border-box;
    text-align: left; background: #16161f; padding: 10px 12px;
    border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); overflow: hidden;
  }
  .luxe-dot { width: 7px; height: 7px; border-radius: 99px; border: 0; padding: 0; background: rgba(255,255,255,0.22); cursor: pointer; }
  .luxe-dot.is-on { background: #fff; width: 22px; }
  @media (min-width: 960px) {
    .luxe-landing-grid { grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.05fr); gap: 28px 32px; }
  }
  @media (min-width: 1400px) {
    .luxe-album { width: min(440px, 26vw); }
    .luxe-flow { height: min(460px, 60vh); }
    .luxe-album-lg { width: min(340px, 24vw); }
    .luxe-flow-lg { height: min(500px, 52vh); }
  }
  @media (max-width: 959px) {
    .luxe-landing, .luxe-gallery { padding: 16px 16px 12px; justify-content: flex-start; }
    .luxe-landing-grid { flex: 1; grid-template-rows: auto 1fr; gap: 12px; }
    .luxe-landing-copy { text-align: center; }
    .luxe-h1 { font-size: clamp(28px, 8.2vw, 40px); }
    .luxe-gallery .luxe-h1 { font-size: clamp(24px, 6.6vw, 32px); }
    .luxe-slogan { font-size: clamp(16px, 4.6vw, 22px); }
    .luxe-lede { display: none; }
    .luxe-cta-desktop { display: none; }
    .luxe-cta-mobile { display: block; margin-top: 12px; }
    .luxe-cta { flex-direction: column; }
    .luxe-cta button { width: 100%; }
    .luxe-gallery-cta { flex-direction: row; flex-wrap: nowrap; }
    .luxe-gallery-cta button { width: auto; flex: 1; }
    .luxe-art-class { margin-left: auto; margin-right: auto; text-align: left; }
    .luxe-landing-bottom { display: flex; flex-direction: column; min-height: 0; }
    .luxe-flow { height: min(320px, 46svh); }
    .luxe-album { width: min(300px, 78vw); padding: 12px; }
    .luxe-album h2 { font-size: 18px; }
    .luxe-album p { font-size: 13px; -webkit-line-clamp: 2; }
    .luxe-gallery { padding: 10px 16px 8px; }
    .luxe-gallery-stage { margin-top: 10px; }
    .luxe-gallery-cta { margin-top: 10px; flex-direction: row; flex-wrap: nowrap; }
    .luxe-gallery-cta button { width: auto; flex: 1; }
    .luxe-flow-lg { height: min(340px, 46svh); }
    .luxe-album-lg { width: min(228px, 62vw, 32svh); padding: 10px; }
    .luxe-gallery-prompt { height: 6.6rem; padding: 8px 10px; }
    .luxe-prompt { font-size: 13px; }
    .luxe-portal { display: none; }
  }
`;
