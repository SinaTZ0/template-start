# Repository Instructions

These instructions apply to the entire repository unless overridden by a more specific `AGENTS.md` in a subdirectory.

This is a React Router v8 application using Framework Mode, started from the project template. The application's user-facing content is in Persian and right-to-left. Its look and feel is defined in `docs/frontend/app-identity.md`.

The docs have two entry points. Start backend work at `docs/backend-flow.md` and frontend work at `docs/frontend-flow.md`. Each one is a list of steps that links to the rule docs in `docs/backend/` and `docs/frontend/` at the step where they apply.

- Backend: contract-first oRPC, Better-Auth email + password with an Altcha sign-up captcha, Drizzle + Postgres, image uploads to S3-compatible storage (`docs/backend/media.md`), and pino logging with per-request timing, plus error and slow-request reports to the error viewer, a small Go service in `tools/error-viewer/` (`docs/backend/logging.md`).
- Frontend: flat route slices and primitives (`docs/frontend/architecture.md`, `docs/frontend/components.md`).
- Production: Docker Compose with Caddy in front, migrations applied before each deploy, and a `/healthz` check (`docs/deployment.md`).
- The `note` feature (`app/orpc/note/`, `app/routes/notes/`) is the template's worked example. Copy its shape for new features; delete it once the project has its own.

## Working Directory

- Run project commands from the repository root.
- After making code changes, run `pnpm lint` and fix all errors.
- Do not create, switch to, or push branches, worktrees, or tags. All work is committed directly on `main`; if a task seems to need a branch, ask the user first.
- Commit messages follow Conventional Commits (`feat: …`, `fix(note): …`, lowercase subject); the `commit-msg` hook rejects anything else. Never bypass the hooks with `--no-verify`.
- Put temporary scripts, diagnostics, experiments, and logs in `./.tmp-claude/`.
- Create `./.tmp-claude/` as needed. It is gitignored and must never contain deliverable source files.

## Testing and Validation

- Keep automated tests small and focused on consequential business behavior, security boundaries, and meaningful regressions. Do not add exhaustive input matrices, implementation-detail assertions, library behavior tests, logging/timing checks, or tests for routine styling changes.
- After code changes, run `pnpm lint`. Run only existing tests directly relevant to the change; do not run the entire suite for every task. Browser smoke tests are optional and appropriate when changing their covered form flows or when explicitly requested.
- Run `pnpm typecheck` for TypeScript contract changes and `pnpm build` for bundling or runtime concerns. Avoid repeating checks already performed, including the production build run by Playwright.
- If test prerequisites are unavailable, report the limitation. Do not automatically provision databases, push schemas, or install browsers just to run tests.
- Story files are maintained UI documentation. Preserve them during test cleanup, including their existing `play` functions, controls, and callback actions. Keep Storybook for manual previews and accessibility review; do not reintroduce its automatic test runner.

## Route Module Slices (Framework Mode)

- **Keep Route Slices Flat:** In this repository, route module directories under `app/routes/` (or the configured `appDirectory`) must be flat. URL hierarchy does not imply folder nesting (e.g. use `dashboard_user/`, never `dashboard/user/`).
- **Colocate Route Internals:** A route module file, its route exports (`loader`, `action`, `clientLoader`, `clientAction`, `ErrorBoundary`, `meta`, `headers`), `./+types/...` imports, and route-only internals (components, hooks, queries, schemas) must live inside that route's slice.
- **Promote Only When Shared:** Keep code with its immediate route consumer. Only move it to a shared or broader domain location when multiple routes consume it or it clearly belongs to a broader domain abstraction.

```text
app/routes/
  dashboard/
  dashboard_user/
  dashboard_user_setting/
    dashboard-user-setting.tsx  # route module
    components/
    hooks/
    queries.ts
    schema.ts
```

## Code Conventions

Preserve established local conventions unless a rule below explicitly says otherwise.

### Components

- Primitives are this app's versions of shadcn components and live in `app/components/primitive/<name>/` as `<name>.tsx`, `<name>.styles.ts` and `<name>.stories.tsx`. `app/components/ui/` holds the untouched shadcn source as reference only: never edit or import from it. Read `docs/frontend/components.md` before creating or restyling a component.
- Write style maps with `defineStyles` and the shared group names; join them with `joinStyles` / `composeStyles`.
- If a shadcn component has no primitive yet, create one from its `ui/` source, keeping shadcn's API and `data-slot`s.
- App-made components with no shadcn original (e.g. `form-alert`, `site-link`) live in `app/components/shared/<name>/` once more than one route uses them.
- When `shadcn/*` lint flags a class, fix it in this order: an existing variant or size, then layout on the parent, then a new or changed variant in the primitive (`docs/frontend/components.md#fixing-a-lint-error`). Never work around it with a disable comment, a restyled wrapper element, or a raw element in place of the primitive.

### Imports

Import values and types directly from their owning modules. Do not create directory barrel files such as `index.ts`.

### Function Parameters

Prefer a single object parameter when a function has multiple meaningful inputs. Use positional parameters when there is only one input or the ordering is conventional and obvious.

### Section Dividers

Use major dividers between top-level sections to improve code navigation and readability:

```ts
/*===== Section Name =====*/
```

Inside JSX:

```tsx
{
  /*===== Section Name =====*/
}
```

Use minor dividers for distinct phases inside longer functions or JSX:

```ts
/*------ Step Name ------*/
```

```tsx
{
  /*------ SubSection Name ------*/
}
```

Use dividers generously.

### Comments

Comment non-obvious decisions, constraints, edge cases, invariants, and domain-specific reasoning. Prefer explaining **why** over restating what the code already says.

Avoid comments for self-explanatory code.

### Documentation

Add JSDoc to functions, methods, and classes when their purpose, contract, side effects, constraints, or error behavior are not obvious from the code.

Document relevant parameters, return behavior, thrown errors, side effects, and important invariants. Avoid redundant documentation.
