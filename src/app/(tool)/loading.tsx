// Shown instantly while a page's data loads, so a click never feels dead.
export default function Loading() {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      <div className="skeleton__block skeleton__title" />
      <div className="skeleton__block skeleton__line" />
      <div className="skeleton__row">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton__block skeleton__card" />)}
      </div>
    </div>
  );
}
