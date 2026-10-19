# Frontend Architecture (React Router Framework Mode)

The frontend is organized by route. Each route slice owns everything that only it uses, and code moves to a shared
location only when a second consumer needs it. The UI is in Persian and right-to-left.

These are the rules. The steps for building a page are in [frontend-flow.md](../frontend-flow.md).

## Structure

```text
app/
  root.tsx                  # document shell, global providers, root error boundary
  routes.ts                 # route config: maps URLs to route modules
  app.css                   # global styles and theme tokens
  routes/
    <slice>/                # one flat folder per route
      <slice-name>.tsx      # route module
      components/           # components used only by this route
      hooks/                # hooks used only by this route
      queries.ts            # data-fetching options used only by this route
      search-params.ts      # nuqs parsers shared by this route's loader and components
      atoms.ts              # Jotai atoms used only by this route
      schema.ts             # form schemas owned by this route
      *.server.ts           # server-only helpers for this route's loader/action
  components/
    primitive/              # this app's versions of shadcn components
    shared/                 # app-made UI shared by multiple routes
    ui/                     # shadcn source, reference only
  hooks/                    # hooks shared by multiple routes
  atoms/                    # Jotai atoms shared by multiple routes
  lib/                      # shared helpers (browser-safe, or *.server.ts)
  orpc/client.ts            # typed browser API client (see ../backend/architecture.md)
```

Not every slice needs every file. Start with the route module alone and split it out as it grows.

## Route Slices

- **Flat, not nested.** URL hierarchy does not imply folder nesting: use `dashboard_user/`, never `dashboard/user/`.
  Nesting of layouts is expressed in `routes.ts`, not in the file tree.
- **Colocate.** The route module, its exports (`loader`, `action`, `clientLoader`, `clientAction`, `meta`, `headers`,
  `ErrorBoundary`), its `./+types/...` imports, and its private components, hooks, queries, and schemas all live in its
  slice.
- **Promote only when shared.** Move code to `app/components/shared/`, `app/hooks/`, or `app/lib/` only when multiple
  routes use it or it clearly belongs to a broader domain. Never import from another route's slice; promote instead.
- **Use generated types.** Type loaders, actions, and components with the route's generated `Route` types instead of
  hand-written ones.

## Data and the Server Boundary

- **Render-critical data** comes from the route `loader`, so pages render fully on the server. Loaders and actions
  call procedures in-process with `createServerClient(request)` (`app/orpc/server-client.server.ts`); errors arrive as
  `ORPCError` and HTTP status codes don't apply.
- **Client-side interactions** (submitting, refreshing, polling) use the TanStack Query utilities in
  `app/orpc/client.ts`, e.g. `useMutation(orpc.note.create.mutationOptions(...))`. Never call the API with a
  hand-written `fetch`. After a mutation that changes loader data, refresh it with `useRevalidator()` instead of
  patching local copies.
- Layout routes guard pages with `requireSession({ roles })` as route middleware
  (`app/lib/session-guard.server.ts`). It puts the session in the router context, so loaders below it read
  `context.get(sessionContext)` instead of fetching the session again. Procedures check auth again on their own.
- **Server-only code** uses the `.server.ts` suffix and is only imported from loaders, actions, or other server
  modules. Secrets and environment values never reach a component.
- The frontend may import browser-safe backend files (contracts, `constants.ts`, `*.errors.ts`) for types and shared
  option values, never services, repositories, or `*.server.ts` files.

## State

- Server data belongs to loaders and TanStack Query. Shareable view state belongs in URL search params, and form input
  belongs to the form.
- Local state uses `useState` and props. Use Jotai only for client state shared across distant parts of the tree.
- See [`jotai.md`](./jotai.md) for how to define, place, and use atoms.
- URL state goes through nuqs, with one typed parser map per route shared by its loader and components. See
  [`nuqs.md`](./nuqs.md).

## Navigation

- Use `Link`, `NavLink`, `Form` and `useNavigate` from `react-router`. Moving to another pathname fades the page on
  its own; query, hash and nuqs updates stay instant. See [`view-transitions.md`](./view-transitions.md).
- Don't pass React Router's `viewTransition` option. It starts a second view transition that cancels React's.

## Forms

- Forms use `react-hook-form` with `zodResolver` and the `Field` primitives (`Field`, `FieldLabel`, `FieldError`).
- Each form has its own schema in its route's `schema.ts`, written for user experience (messages, when to validate).
  Do not derive it from backend validation, even when the rules currently match; update both explicitly when a
  requirement changes.
- Shared option lists (select values, limits) are imported from the feature's browser-safe constants.
- The server is the final authority. `describeApiFailure` (`app/lib/api-error.ts`) turns an API error into per-field
  messages, shown next to the matching fields, and a general message for the form's `FormAlert`.
- Disable submission while pending and keep the user's input after a failure.

## Components

- One component per file. File names are kebab-case; component names are PascalCase.
- Shared components (`app/components/`) receive page data and callbacks through props and don't fetch, read route
  atoms or URL state, which keeps them reusable and easy to preview. The exception is an app-wide action with one
  meaning everywhere, through a hook in `app/hooks/` (the header's `useSignOut`, the toggle's `useTheme`).
- Inside a route slice, loading stays in the route module. A slice component may own the mutation it triggers (the
  note form calls `useMutation` itself) and tells the page through a callback such as `onCreated`.
- Primitives and visible shared components have Storybook stories. Stories are maintained UI documentation; keep them
  in sync with the component.
- Handle every state a user can see: loading, empty, error, and success.
- Creating, changing and linting primitives: see [components.md](./components.md).

## Persian, RTL, and Accessibility

- The document is `lang="fa"` and `dir="rtl"`. All user-facing text is Persian; code identifiers and developer
  diagnostics stay in English.
- Use logical directions, never physical ones: Tailwind `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`
  instead of `ml-`, `pl-`, `left-`, `text-left`. Mirror directional icons.
- Format numbers with `formatNumberFa` and dates with `Intl` and the `fa-IR` locale. Inputs that accept numbers must
  accept Persian and Arabic digits: normalize them with `toLatinDigits` before parsing. Both helpers are in
  `app/lib/digits.ts`.
- Use semantic elements and native controls first. Every input has a label, every action is keyboard-reachable, and
  errors are announced to assistive technology.

## Styling

- Style with Tailwind utilities. Put design tokens (colors, fonts, spacing scale) in `app.css` instead of hard-coding
  values in components.
- Extract a component when a pattern repeats, not a utility class.
