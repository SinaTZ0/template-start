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

document.addEventListener("DOMContentLoaded", updateTimes);
document.addEventListener("htmx:afterSettle", updateTimes);
setInterval(updateTimes, 30_000);
