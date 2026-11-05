/** Returns a new array with the item at `from` moved to `to`; invalid moves return an unchanged copy. */
export function moveStep<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const inRange = (i: number) => i >= 0 && i < copy.length;
  if (!inRange(from) || !inRange(to) || from === to) return copy;
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}
