"use client";

import { useEffect, useState } from "react";

/** True while the tab is hidden, so loops can pause instead of running in the background. */
export function usePageHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}
