import { useEffect, useState } from "react";

// Two 330 px columns + 18 px gap + 2 × 20 px padding need 718 px. Below that the
// grid collapses to one column, so the phone order takes over.
export const COMPACT_QUERY = "(max-width: 717px)";

const query = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_QUERY)
    : null;

export function useCompact() {
  const [compact, setCompact] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media) return;
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}
