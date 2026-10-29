import { createCn } from "cn/config";

/**
 * Joins class names and resolves Tailwind conflicts (the last class wins).
 *
 * The merge must know the app's type styles (`--text-<name>` in `src/styles.css`): left unknown, `text-h1` reads as a
 * text colour, and `cn("text-h1 text-primary")` would drop the type style. Keep this list in step with `styles.css`.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "stat",
            "h1",
            "h2",
            "h3",
            "h4",
            "body-lg",
            "body",
            "body-sm",
            "caption",
            "button",
            "kicker",
            "nav",
          ],
        },
      ],
    },
  },
});
