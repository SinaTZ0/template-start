# Repository Instructions

These instructions apply to the entire repository unless overridden by a more specific `AGENTS.md` in a subdirectory.

This is a TanStack Start application (TanStack Router + TanStack Query, built by Vite and served by Nitro), started from the project template. The application is Persian first (right-to-left), with English (left-to-right) as a second language; every text a person reads is a Paraglide message (`docs/frontend/i18n.md`). Its look and feel is defined in `docs/frontend/app-identity.md`.

The docs have two entry points. Start backend work at `docs/backend-flow.md` and frontend work at `docs/frontend-flow.md`. Each one is a list of steps that links to the rule docs in `docs/backend/` and `docs/frontend/` at the step where they apply. Work that spans both (a new feature, a new field shown on a page) follows the backend flow first, then the frontend flow. When a new project starts from the template, `docs/customize-template.md` turns its homepage design into the app's design system.

- Backend: contract-first oRPC, Better-Auth email + password with an Altcha sign-up captcha, per-address rate limits on the API and auth endpoints (`docs/backend/architecture.md` → Rate limiting), Drizzle + Postgres, image uploads to S3-compatible storage (`docs/backend/media.md`), and pino logging with per-request timing, plus error and slow-request reports to the error viewer, a small Go service in `tools/error-viewer/` (`docs/backend/logging.md`).
- Frontend: flat route slices and primitives (`docs/frontend/architecture.md`, `docs/frontend/components.md`), TanStack Query as the one data cache, filled by route loaders and preloaded on hover (`docs/frontend/data-loading.md`), typed search params (`docs/frontend/search-params.md`), page meta through `pageMeta` (`docs/frontend/seo.md`), and Persian and English messages through Paraglide JS, with the language in the URL (`/notes`, `/en/notes`; `docs/frontend/i18n.md`).
- Production: Docker Compose with Caddy in front, migrations applied before each deploy, and a `/healthz` check (`docs/deployment.md`).
- The `note` feature (`src/orpc/note/`, `src/routes/notes/`) is the template's worked example. Copy its shape for new features; delete it once the project has its own.

## Working Directory

- Run project commands from the repository root.
- After making code changes, run `pnpm lint` and fix all errors.
- Do not create, switch to, or push branches, worktrees, or tags. All work is committed directly on `main`; if a task seems to need a branch, ask the user first.
- Commit messages follow Conventional Commits (`feat: …`, `fix(note): …`, lowercase subject); the `commit-msg` hook rejects anything else. Never bypass the hooks with `--no-verify`.
- Before committing a change to seed data (the paths in `deploy/steps/needs-step.txt`), add the deploy step the server needs (`deploy/steps/`, the `how-update-server` skill); the `commit-msg` hook checks.
- Put temporary scripts, diagnostics, experiments, and logs in `./.tmp-claude/`.
- Create `./.tmp-claude/` as needed. It is gitignored and must never contain deliverable source files.

## Testing and Validation

- Keep automated tests small and focused on consequential business behavior, security boundaries, and meaningful regressions. Do not add exhaustive input matrices, implementation-detail assertions, library behavior tests, logging/timing checks, or tests for routine styling changes.
- After code changes, run `pnpm lint`. Run only existing tests directly relevant to the change; do not run the entire suite for every task. Browser smoke tests are optional and appropriate when changing their covered form flows or when explicitly requested.
- Run `pnpm typecheck` for TypeScript contract changes and `pnpm build` for bundling or runtime concerns. Avoid repeating checks already performed, including the production build run by Playwright.
- If test prerequisites are unavailable, report the limitation. Do not automatically provision databases, push schemas, or install browsers just to run tests.
- Story files are maintained UI documentation. Preserve them during test cleanup, including their existing `play` functions, controls, and callback actions. Keep Storybook for manual previews and accessibility review; do not reintroduce its automatic test runner.

## Route Slices (TanStack Start)

- **Keep Route Slices Flat:** Route folders under `src/routes/` must be flat. URL hierarchy does not imply folder nesting (e.g. use `dashboard_user/`, never `dashboard/user/`). The route tree, including layouts, is declared in `src/routes.ts` with virtual file routes (`rootRoute`, `layout`, `index`, `route`); `src/routeTree.gen.ts` is generated from it, so never edit it.
- **Declare Every Route in `src/routes.ts`:** Only files listed there become routes. Name a slice after its URL segments joined with `_`, without `$` (`/notes/$noteId` → `notes_noteId/notes-note-id.tsx`); pathless layouts are `<name>_layout/`. Server routes (`/rpc/$`, `/healthz`) are slices with `server.handlers` and no `component`.
- **No React Server Components:** No `"use server"` / `"use client"` directives or Start RSC APIs; server work goes through oRPC procedures.
- **Colocate Route Internals:** A route file (`export const Route = createFileRoute(...)`), its options (`beforeLoad`, `loader`, `loaderDeps`, `validateSearch`, `head`, `component`, `pendingComponent`, `errorComponent`, `notFoundComponent`, `server.handlers`), and route-only internals (components, hooks, queries, search schema, form schemas) must live inside that route's slice.
- **Promote Only When Shared:** Keep code with its immediate route consumer. Only move it to a shared or broader domain location when multiple routes consume it or it clearly belongs to a broader domain abstraction.

```text
src/routes/
  dashboard/
  dashboard_user/
  dashboard_user_setting/
    dashboard-user-setting.tsx  # route file
    components/
    hooks/
    queries.ts
    schema.ts
```

## Data Loading

The rules are in `docs/frontend/data-loading.md`.

- Route `beforeLoad` and `loader` are isomorphic: they run on the server for the first request and in the browser afterwards. Server-only modules (`*.server.ts`, the database, `env`) are only used behind an oRPC procedure, never directly in route code. All server data comes from procedures, the viewer (`session.viewer`) and site origin (`site.origin`) included.
- Read page data in loaders with `context.queryClient.ensureQueryData(options)` and in components with `useSuspenseQuery` on the same options. `useQuery` doesn't run during SSR, so it renders an empty page on the server.
- Create the `QueryClient` inside `getRouter()` (`src/router.tsx`), never at module scope: a module-level client on the server shares one user's data with the next.
- Every mutation invalidates the query keys it changes (`orpc.<feature>.<procedure>.key()`). Changes made elsewhere are covered by `staleTime` (5 minutes by default; shorter on queries that should show others' changes sooner).
- Guards are a layout's `beforeLoad` with `throw redirect(...)`; they only shape navigation. Security stays in the oRPC middleware.
- A browser-only module uses `createClientOnlyFn`, not a `.client.ts` name: Start's import protection rejects `.client` files in code the server renders.
- No server functions: don't use `createServerFn` or a `src/start.ts`, even where the Start skills suggest them. One way into the server keeps one set of rules for validation, rate limits, errors and CSRF; a small read is a procedure too.
- Use current Start API names: `.validator()` on middleware (`.inputValidator()` was the RC name), `getRequest` / `getRequestHeaders` from `@tanstack/react-start/server`, server routes as `server: { handlers }` on `createFileRoute`. Add a cookie with `setCookie` or `appendResponseHeader`; `setResponseHeader("set-cookie", ...)` replaces all of them.
- TanStack Start's own guidance is in the `react-start`, `start-core`, `router-core` and `virtual-file-routes` skills (`.agents/skills/`).

## Languages

The rules are in `docs/frontend/i18n.md`.

- Every text a person reads (labels, `aria-label`s, titles, descriptions, form and API error messages) is a message: add the key to `messages/fa.json` and `messages/en.json` and call `m.<key>()` from `#/paraglide/messages`. Never hardcode user-facing text. Logs, identifiers and developer diagnostics stay in English.
- Never call a message at module scope: a module is evaluated once per server process, so the text would be frozen in one locale. Store the message function (`label: m.nav_home`), give zod checks `{ error: () => m.x() }`, and export functions instead of string constants.
- Pass numbers to messages and format them there (`local maxText = max: number`); outside messages use `formatNumber` / `formatDate` (`src/lib/locale.ts`), never an `Intl` formatter with a fixed locale.
- Routes, `<Link to>` and redirects use the plain path (`/notes`); the router adds the locale prefix. Use logical classes only (`ms-`, `ps-`, `start-`, `text-start`), so layouts work in both directions.
- `src/paraglide/` is generated (`pnpm i18n:compile`, or the Vite plugin); never edit it.

## Code Conventions

Preserve established local conventions unless a rule below explicitly says otherwise.

### Components

- Primitives are this app's versions of shadcn components and live in `src/components/primitive/<name>/` as `<name>.tsx`, `<name>.styles.ts` and `<name>.stories.tsx`. `src/components/ui/` holds the untouched shadcn source as reference only: never edit or import from it. Read `docs/frontend/components.md` before creating or restyling a component.
- Write style maps with `defineStyles` and the shared group names; join them with `joinStyles` / `composeStyles`.
- If a shadcn component has no primitive yet, create one from its `ui/` source, keeping shadcn's API and `data-slot`s.
- App-made components with no shadcn original (e.g. `form-alert`, `site-link`) live in `src/components/shared/<name>/` once more than one route uses them.
- When `shadcn/*` lint flags a class, fix the code it points at: a variant or base style in the primitive, layout on the parent, or a token in `src/styles.css` (`docs/frontend/components.md#lint-rules`). Don't hide the styling in a wrapper element or a raw element in place of the primitive.
- The current look (tokens in `src/styles.css`, primitives, existing pages) serves the design, not the other way round. When a design needs something different, change the primitives and `src/styles.css` instead of bending the design to fit them.

### Imports

Import values and types directly from their owning modules, through the `#/` alias for anything under `src/` (`#/lib/seo`). Do not create directory barrel files such as `index.ts`.

### Function Parameters

Prefer a single object parameter when a function has multiple meaningful inputs. Use positional parameters when there is only one input or the ordering is conventional and obvious.

### Section Dividers

Use dividers generously: major `/*===== Section Name =====*/` between top-level sections, minor `/*------ Step Name ------*/` for distinct phases inside longer functions or JSX. Inside JSX, wrap them in braces (`{/*===== Section Name =====*/}`).

### Comments

Comment non-obvious decisions, constraints, edge cases, invariants, and domain-specific reasoning. Prefer explaining **why** over restating what the code already says.

Avoid comments for self-explanatory code.

### Documentation

Add JSDoc to functions, methods, and classes when their purpose, contract, side effects, constraints, or error behavior are not obvious from the code.

Document relevant parameters, return behavior, thrown errors, side effects, and important invariants. Avoid redundant documentation.
