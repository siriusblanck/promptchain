"use client";

import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { CardView } from "@/lib/chains/card-view";

type Props = {
  label: string; tileNumber?: string; title: string; meta: string; view: CardView;
  done: boolean; hollow: boolean; selected?: boolean; onSelect?: () => void; moves?: ReactNode;
  /** Accessible name for the clickable tile; defaults to "Edit step …". */
  actionLabel?: string;
  /** When set, an image dropped on the tile is handed to this callback. */
  onDropFile?: (file: File) => void;
};

export function StepCard(props: Props) {
  const { label, tileNumber = label, title, meta, view, done, hollow, selected, onSelect, moves, actionLabel, onDropFile } = props;
  const [dragging, setDragging] = useState(false);
  const dropHandlers = onDropFile
    ? {
        onDragOver: (e: DragEvent<HTMLElement>) => { e.preventDefault(); setDragging(true); },
        onDragLeave: () => setDragging(false),
        onDrop: (e: DragEvent<HTMLElement>) => {
          e.preventDefault();
          setDragging(false);
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
          if (file) onDropFile(file);
        },
      }
    : {};
  const className = `card-media card-media--${view.kind === "photo" ? "photo" : "text"}${dragging ? " card-media--drop" : ""}`;
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
        <button type="button" className={className} style={style} aria-pressed={selected} onClick={onSelect}
          aria-label={actionLabel ?? `Edit step ${label}, ${title}`} {...dropHandlers}>{media}</button>
      ) : (
        <div className={className} style={style} {...dropHandlers}>{media}</div>
      )}
      <p className="card-title">{title}</p>
      <p className="card-meta">{meta}</p>
      {view.stat && <p className="card-stat">{view.stat}</p>}
      {moves}
    </div>
  );
}
