import { useEffect, useRef, useState } from "react";

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * TEMP: on-screen console for iPhone (no Mac Web Inspector).
 * Remove after the AOP mobile ATC / stale-mockup trace.
 */
export function MobileDebugOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    const append = (level: string, args: unknown[]) => {
      const stamp = new Date().toISOString().slice(11, 23);
      const text = `[${stamp}] ${level} ${args.map(formatArg).join(" ")}`;
      setLines((prev) => {
        const next = prev.length >= 120 ? prev.slice(-119) : prev.slice();
        next.push(text);
        return next;
      });
    };

    console.log = (...args: unknown[]) => {
      origLog(...args);
      append("L", args);
    };
    console.warn = (...args: unknown[]) => {
      origWarn(...args);
      append("W", args);
    };
    console.error = (...args: unknown[]) => {
      origError(...args);
      append("E", args);
    };

    origLog("[debugoverlay] on");
    append("L", ["[debugoverlay] on"]);

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={boxRef}
      data-testid="mobile-debug-overlay"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: "30vh",
        zIndex: 9999,
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        background: "rgba(0,0,0,0.72)",
        color: "#d1f7c4",
        font: "10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "6px 8px",
        boxSizing: "border-box",
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
