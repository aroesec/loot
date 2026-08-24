"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark" | null>(null);

  // The inline head script has already set data-theme; read it rather than
  // guessing, so the button never disagrees with what's rendered.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setMode(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = mode === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("loot-mode", next);
    setMode(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn !px-2.5 !py-1.5"
      aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
    >
      <span aria-hidden className="text-xs">
        {mode === "dark" ? "☾" : "☀"}
      </span>
    </button>
  );
}
