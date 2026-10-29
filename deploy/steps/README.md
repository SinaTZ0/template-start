# Deploy Steps

Commands a commit needs on the server after its code is deployed, such as loading edited seed data again. Every
deploy (`deploy/deploy.sh update` or `apply`) runs the steps the server's ledger hasn't recorded, in name order, and
stops at the first that fails. The rules are in `docs/deployment.md` → Deploy Steps.

A step is a file named `<yyyymmdd>-<hhmm>-<what>.md`, added in the commit that needs it:

```md
---
run:
  - seed notes --replace
---

The sample notes were rewritten in src/db/seed-notes.ts. This replaces the first admin's sample notes; their own notes
stay.
```

- `run:` lists the commands, in order. Only the deploy tool's `seed …` commands may be steps (`deploy/deploy.sh help`).
- The text under the front matter says why, and what the commands overwrite.
- Don't edit a step once it's committed: the server records how many of its commands ran. Add a new step instead.
  Deleting one is fine.
- A commit that changes a path in `needs-step.txt` needs a step, or a `Deploy-Step: none` line in its message when the
  server should keep its data (editors already changed it there).
