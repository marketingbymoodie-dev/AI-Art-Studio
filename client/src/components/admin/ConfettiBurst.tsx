const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#eab308", "#ec4899", "#a855f7"];

/**
 * Pure-CSS confetti burst, absolutely positioned over its (relatively
 * positioned) parent. Mount for ~1.2s after a celebratory action (e.g. the
 * setup rail's "product activated" moment) then unmount.
 */
export default function ConfettiBurst({ pieceCount = 24 }: { pieceCount?: number }) {
  const pieces = Array.from({ length: pieceCount }, (_, i) => i);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.25;
        const duration = 0.9 + Math.random() * 0.6;
        const color = COLORS[i % COLORS.length];
        return (
          <span
            key={i}
            className="appai-confetti-piece"
            style={{
              left: `${left}%`,
              backgroundColor: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
}
