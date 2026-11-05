"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const OPTIONS = [["light", "Light"], ["dark", "Dark"], ["system", "System"]] as const;
const noopSubscribe = () => () => {};

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  // The stored choice is unknown on the server; render all buttons unpressed until hydrated.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return (
    <div className="seg" role="group" aria-label="Color theme">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" className="seg__item" aria-pressed={hydrated && theme === value} onClick={() => setTheme(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
