const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Glides the window until `element` sits `offset` px below the top. Slower and softer than
 * native smooth scrolling; jumps instantly for reduced-motion users.
 */
export function smoothScrollTo(element: Element | null, { duration = 750, offset = 24 } = {}): void {
  if (!element) return;
  const start = window.scrollY;
  const target = Math.max(0, element.getBoundingClientRect().top + start - offset);
  const distance = target - start;
  if (prefersReducedMotion() || Math.abs(distance) < 2) {
    window.scrollTo(0, target);
    return;
  }
  const began = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - began) / duration);
    window.scrollTo(0, start + distance * easeInOutCubic(progress));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
