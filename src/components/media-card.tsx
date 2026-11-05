import type { CSSProperties } from "react";
import { pad2, ratioOf, tileColor } from "@/lib/chains/presentation";
import type { MediaRun } from "@/lib/runs/media";

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export function MediaCard({ run }: { run: MediaRun }) {
  const style = run.photo ? ({ "--ratio": ratioOf(run.photo) } as CSSProperties) : undefined;
  return (
    <article className="run-card">
      <div className="run-card__photo" style={style}>
        {run.photo ? (
          <img src={run.photo.url} alt="Run media" />
        ) : (
          <span className="tile tile--orange"><span className="tile__n">{pad2(run.trail.length)}</span><span className="tile__q">Text-only run</span></span>
        )}
      </div>
      <div>
        <p className="card-title" style={{ marginTop: 0 }}>{WHEN.format(new Date(run.createdAt))}</p>
        <p className={run.failed ? "card-stat card-stat--failed" : "card-stat"}>{run.statusLabel}</p>
        <ol className="trail" aria-label="Steps">
          {run.trail.map((s, i) => <li key={s.order} className={`tile--${tileColor(i)}`}>{pad2(s.order)} {s.title}</li>)}
        </ol>
        {run.inputText && <p className="card-meta">Input: “{run.inputText}”</p>}
        {run.finalLines ? (
          <ol className="output-list">{run.finalLines.map((line, i) => <li key={i}>{line}</li>)}</ol>
        ) : (
          run.finalText && <p className="output-text">{run.finalText}</p>
        )}
      </div>
    </article>
  );
}
