/*===== SQL In A Timeline =====*/
const MAX_SQL_LENGTH = 300;

/**
 * The query's shape, short enough to read in a timeline: identifier quotes and column lists are dropped, the tables,
 * joins and conditions stay. `select "note"."id", … from "note" where "note"."owner_id" = $1` becomes
 * `select … from note where note.owner_id = $1`. Parameters are never included.
 */
export function sqlText(input: unknown): string {
  const text = typeof input === "string" ? input : (input as { text?: unknown } | null)?.text;
  if (typeof text !== "string") return "(unknown query)";
  const short = text
    .replace(/\s+/g, " ")
    .replaceAll('"', "")
    // The first `from` ends the column list. A subquery in it would end the list early, which still reads fine.
    .replace(/^select (distinct )?.+? from /i, "select $1… from ")
    .replace(/ returning .+$/i, " returning …")
    .replace(/^insert into (\S+) \(.+?\) values .+?( on conflict| returning|$)/i, "insert into $1 …$2")
    .replace(/ set .+? where /i, " set … where ")
    .trim();
  return short.length > MAX_SQL_LENGTH ? `${short.slice(0, MAX_SQL_LENGTH)}…` : short;
}
