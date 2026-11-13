import { useEffect, useState } from "react";

import { cn } from "#/lib/utils";

/*===== Study Bar =====*/
// Copy into the study's folder. Study-only chrome pinned to the bottom of the window, clear of the dev tools' button:
// the notes, the option keys, and one line of live measurements. Raise it (`bottom-*`) in an app with a bar of its own
// fixed to the bottom of the screen. It is English on purpose: it is for the people comparing the options and never reaches the
// app, so none of its text is a message.
//
// Keys go by `event.code`, the key's place on the keyboard, so they work on a Persian layout too (`۱`, `ن`): 0–9 pick an
// option, b–h a version of the current one (`3b`, `3c`), a goes back to the plain option, n shows or hides the notes.

export type StudyOption = {
  /** "0" is the current design; "1"–"9" the options; "3b", "3c" versions of option 3. */
  id: string;
  name: string;
  /** What it is and why, in two sentences at most. */
  lead: string;
  good: string[];
  /** The real risks: hidden content, covered text, dark mode, a long Persian title, the phone. */
  watch: string[];
  /** What it costs in this codebase: components, primitives, tokens, any backend change. */
  build: string[];
};

const VERSION_KEYS = ["KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH"];

export function StudyBar({
  options,
  opt,
  onPick,
  measure,
}: {
  options: StudyOption[];
  opt: string;
  onPick: (id: string) => void;
  /** A live reading to print, such as a panel's height; read once a second, since data arrives after first paint. */
  measure?: () => string;
}) {
  // Open from the start, so the reader knows what an option is before comparing it.
  const [open, setOpen] = useState(true);
  const [reading, setReading] = useState("");
  const note = options.find((option) => option.id === opt) ?? options[0];

  useEffect(() => {
    if (!measure) return;
    const timer = setInterval(() => setReading(measure()), 1000);
    return () => clearInterval(timer);
  }, [measure, opt]);

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      const base = (note?.id ?? "0").replace(/\D+$/, "");
      const digit = /^Digit(\d)$/.exec(event.code)?.[1];
      const version = VERSION_KEYS.indexOf(event.code);
      let id: string | undefined;
      if (digit) id = digit;
      else if (version >= 0) id = `${base}${String.fromCharCode(98 + version)}`;
      else if (event.code === "KeyA") id = base;
      else if (event.code === "KeyN") setOpen((value) => !value);
      if (id && options.some((option) => option.id === id)) onPick(id);
    };
    document.addEventListener("keydown", press);
    return () => document.removeEventListener("keydown", press);
  }, [note, onPick, options]);

  const list = (title: string, items: string[]) => (
    <div>
      <h3 className="mb-1 text-caption text-muted-foreground">{title}</h3>
      <ul className="list-disc space-y-1 ps-4 text-body-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      data-study-bar
      dir="ltr"
      lang="en"
      className="fixed inset-x-2 bottom-2 z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-md md:inset-x-4 md:end-20"
    >
      {open && note && (
        <div
          data-study-notes
          className="grid max-h-[40vh] gap-4 overflow-y-auto border-b border-border p-4 md:grid-cols-[1.3fr_1fr_1fr_1fr] md:gap-6"
        >
          <div>
            <h3 className="mb-1 text-caption text-muted-foreground">{`${note.id} · ${note.name}`}</h3>
            <p className="text-body-sm">{note.lead}</p>
          </div>
          {list("Good", note.good)}
          {list("Watch", note.watch)}
          {list("Build", note.build)}
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto p-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === note?.id}
            onClick={() => onPick(option.id)}
            className={cn(
              "shrink-0 cursor-pointer rounded-md px-3 py-1 text-start text-body-sm font-semibold",
              option.id === note?.id ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <span className="me-1.5 font-mono opacity-70">{option.id}</span>
            {option.name}
          </button>
        ))}
        <span className="ms-auto shrink-0 font-mono text-caption text-muted-foreground">{reading}</span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="ms-3 shrink-0 cursor-pointer rounded-md px-3 py-1 text-body-sm font-semibold hover:bg-accent"
        >
          {open ? "Hide notes (n)" : "Notes (n)"}
        </button>
      </div>
    </div>
  );
}
