import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "#/orpc/client";
import { m } from "#/paraglide/messages";

/*===== Note Stats =====*/
/**
 * Every account's notes in one line. Render it for admins only: the procedure refuses any other role, and the page's
 * loader fills this query for admins alone.
 */
export function NoteStats() {
  const { data: stats } = useSuspenseQuery(orpc.note.stats.queryOptions());

  return <p className="text-sm text-muted-foreground">{m.notes_stats(stats)}</p>;
}
