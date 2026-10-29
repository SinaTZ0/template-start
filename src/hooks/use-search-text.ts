import { useEffect, useState } from "react";

/*===== Search Text =====*/

/**
 * A search field's draft, written to the URL after a pause so typing doesn't navigate on every key
 * (docs/frontend/search-params.md → Text Inputs). `value` is the URL's text; `onCommit` writes a new one.
 */
export function useSearchText({
  value,
  onCommit,
  delay = 300,
}: {
  value: string;
  onCommit: (text: string) => void;
  delay?: number;
}): [string, (text: string) => void] {
  // The draft remembers which URL text it was typed over: when Back or Forward changes the URL under it, the field
  // shows the URL's text again instead of the stale draft.
  const [draft, setDraft] = useState({ text: value, over: value });
  const text = draft.over === value ? draft.text : value;

  useEffect(() => {
    if (text.trim() === value) return;
    const timer = setTimeout(() => onCommit(text.trim()), delay);
    return () => clearTimeout(timer);
  }, [text, value, onCommit, delay]);

  return [text, (next: string) => setDraft({ text: next, over: value })];
}
