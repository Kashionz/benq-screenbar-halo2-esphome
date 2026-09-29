import { useEffect, useState } from "react";

// Two columns need 420 + 330 px bases, an 18 px gap and 2 × 20 px padding:
// 808 px. Below that the main screen stacks in the phone order.
export const SINGLE_COLUMN_QUERY = "(max-width: 807px)";
// Phone layout: tighter padding, two preset columns, stacked settings.
export const PHONE_QUERY = "(max-width: 599px)";

const media = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query)
    : null;

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => media(query)?.matches ?? false);
  useEffect(() => {
    const list = media(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
