import type { CSSProperties, ReactNode } from "react";
import type { CardView } from "@/lib/chains/card-view";

type Props = {
  label: string; tileNumber?: string; title: string; meta: string; view: CardView;
  done: boolean; hollow: boolean; selected?: boolean; onSelect?: () => void; moves?: ReactNode;
};

export function StepCard({ label, tileNumber = label, title, meta, view, done, hollow, selected, onSelect, moves }: Props) {
  const className = `card-media card-media--${view.kind === "photo" ? "photo" : "text"}`;
  const style = view.kind === "photo" ? ({ "--ratio": view.ratio } as CSSProperties) : undefined;
  const media = view.kind === "photo" ? (
    <img src={view.url} alt={`${title}: latest image`} />
  ) : (
    <span className={`tile tile--${view.tone}`}>
      <span className="tile__n">{tileNumber}</span>
      {view.text && <span className="tile__q">{view.text}</span>}
    </span>
  );
  return (
    <div className={`wall__col${done ? " wall__col--done" : ""}`}>
      <div className="node">
        <span className={`node__mark${hollow ? " node__mark--hollow" : ""}`} />
        <span className="node__label">{label}</span>
      </div>
      {onSelect ? (
        <button type="button" className={className} style={style} aria-pressed={selected} onClick={onSelect} aria-label={`Edit step ${label}, ${title}`}>{media}</button>
      ) : (
        <div className={className} style={style}>{media}</div>
      )}
      <p className="card-title">{title}</p>
      <p className="card-meta">{meta}</p>
      {view.stat && <p className="card-stat">{view.stat}</p>}
      {moves}
    </div>
  );
}
