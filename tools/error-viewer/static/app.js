// The dashboard's only script besides htmx. It lives in a file because the CSP allows no inline scripts.

/*===== Setup =====*/
// Lets the CSS show what needs a script (copy buttons) and hide what doesn't (the search button).
document.documentElement.classList.add("js");

/*===== Filters =====*/
// Leaves empty filters out of the request, so the pushed URL reads `/?level=error` rather than
// `/?q=&level=error&kind=&…`.
document.addEventListener("htmx:configRequest", (event) => {
  if (event.target.id !== "filters") return;
  for (const [name, value] of Object.entries(event.detail.parameters)) {
    if (value === "") delete event.detail.parameters[name];
  }
});

/*===== Row Selection =====*/
// The header box checks every row, and reads as "some" when only some are checked. Rows that arrive by "Load more" or
// auto-refresh start unchecked, so the header and the delete button are re-synced after every swap.
function syncSelection() {
  const boxes = [...document.querySelectorAll('input[name="id"]')];
  const selected = boxes.filter((box) => box.checked).length;

  const all = document.getElementById("select-all");
  if (all) {
    all.checked = boxes.length > 0 && selected === boxes.length;
    all.indeterminate = selected > 0 && selected < boxes.length;
  }
  const remove = document.getElementById("delete-selected");
  if (remove) remove.disabled = selected === 0;
}

document.addEventListener("change", (event) => {
  if (event.target.id === "select-all") {
    for (const box of document.querySelectorAll('input[name="id"]')) box.checked = event.target.checked;
    syncSelection();
  } else if (event.target.name === "id") {
    syncSelection();
  }
});

/*===== Client Groups =====*/
// Consecutive rows from the same browser (`data-client`) are drawn as one card: the first row shows the client and how
// many events follow, the rest sit under it with lighter dividers. Only runs that are next to each other in the list
// group, so a client whose errors are interleaved with another's shows as separate cards, in the order they happened.
// Re-run after every swap: "Load more" can continue the last card, and auto-refresh can extend the first.
function groupRows() {
  const rows = [...document.querySelectorAll("#rows tr[data-client]")];
  for (const row of rows) {
    row.classList.remove("group", "group-first", "group-last");
    const cell = row.querySelector("td.client");
    if (cell) delete cell.dataset.groupSize;
  }

  /*------ Find Runs ------*/
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    const client = rows[start].dataset.client;
    if (i < rows.length && client && rows[i].dataset.client === client) continue;

    /*------ Mark a Run ------*/
    const run = rows.slice(start, i);
    if (run.length > 1) {
      for (const row of run) row.classList.add("group");
      run[0].classList.add("group-first");
      // On the cell, not the row: the CSS shows it with `attr()`, which reads only the element's own attributes.
      const cell = run[0].querySelector("td.client");
      if (cell) cell.dataset.groupSize = `${run.length} events`;
      run.at(-1).classList.add("group-last");
    }
    start = i;
  }
}

/*===== Copy Buttons =====*/
// `data-copy` holds the text itself; `data-copy-from` names an element whose text is copied.
document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-copy], [data-copy-from]") : null;
  if (!button) return;

  const source = button.dataset.copyFrom ? document.querySelector(button.dataset.copyFrom) : null;
  const text = button.dataset.copy ?? source?.textContent ?? "";
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    // The clipboard needs HTTPS (or localhost).
    button.textContent = "Failed";
  }
  setTimeout(() => {
    button.textContent = label;
  }, 1200);
});

/*===== Times =====*/
// The server renders "5m ago" in UTC terms; here it is kept current, and hovering shows the local time.
function timeAgo(date) {
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function updateTimes() {
  for (const element of document.querySelectorAll("time[data-ago]")) {
    const date = new Date(element.dateTime);
    if (Number.isNaN(date.getTime())) continue;
    element.textContent = timeAgo(date);
    element.title = date.toLocaleString();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateTimes();
  syncSelection();
  groupRows();
});
document.addEventListener("htmx:afterSettle", () => {
  updateTimes();
  syncSelection();
  groupRows();
});
setInterval(updateTimes, 30_000);
