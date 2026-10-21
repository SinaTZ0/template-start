# Jotai (Shared Client State)

Jotai holds **client UI state that distant components share**. An atom is only a definition. Its value lives in a
store, and the root document (`app/root.tsx`) gives every render tree its own store through `<Provider>`. Most state does not belong in
Jotai. Check the next section before creating an atom.

## What Goes Where

| State                                                                    | Owner                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Server data                                                              | TanStack Query through the oRPC client ([`data-loading.md`](./data-loading.md)) |
| Shareable or bookmarkable state (filters, tabs, pagination, selected id) | URL search params ([`search-params.md`](./search-params.md))                    |
| Form input                                                               | The form and its `schema.ts`                                                    |
| State used by one component, or passed one or two levels down            | `useState` and props                                                            |
| Client state shared across distant parts of the tree                     | **Jotai**                                                                       |

Never copy query data into atoms. Two copies drift apart, and refetches stop reaching the UI.

## Defining Atoms

- **Define atoms at module scope.** An atom created during render is a new atom on every render. Create one inside a
  component only when each instance needs its own state, and then wrap it in `useMemo`.
- **Use the `Atom` suffix:** `sidebarOpenAtom`, `cartItemsAtom`.
- **Keep atoms small and derive the rest.** Store the minimal source state in primitive atoms, and compute everything
  else with read-only derived atoms instead of keeping a second copy in sync.
- **Put mutations in action atoms.** A write-only atom (`atom(null, (get, set, arg) => ...)`) keeps the update logic
  next to the state, so components don't each reimplement it.
- **Type the initial value** when it doesn't show the full type: `atom<string | null>(null)`.

```ts
// app/routes/checkout/atoms.ts
import { atom } from "jotai";

type CartItem = { id: string; price: number; quantity: number };

/*===== Source State =====*/
export const cartItemsAtom = atom<CartItem[]>([]);

/*===== Derived State =====*/
export const cartTotalAtom = atom((get) =>
  get(cartItemsAtom).reduce((sum, item) => sum + item.price * item.quantity, 0),
);

/*===== Actions =====*/
export const removeCartItemAtom = atom(null, (get, set, itemId: string) => {
  set(
    cartItemsAtom,
    get(cartItemsAtom).filter((item) => item.id !== itemId),
  );
});
```

## Where Atoms Live

Atoms follow the same colocation rule as every other piece of code:

- An atom used by one route lives in that route's `atoms.ts` (`app/routes/<slice>/atoms.ts`).
- Move it to `app/atoms/<domain>.ts` only when a second route needs it. Never import atoms from another route's slice.
- Import atoms directly from the file that defines them. Don't add barrel files.

## Reading and Writing

Use the narrowest hook:

- `useAtomValue(atom)` when the component only reads.
- `useSetAtom(atom)` when it only writes. The component doesn't re-render when the value changes.
- `useAtom(atom)` only when the component both reads and writes.

```tsx
const total = useAtomValue(cartTotalAtom);
const removeItem = useSetAtom(removeCartItemAtom);
```

Use atoms in route modules and in the route's own components. Shared components in `app/components/` get their data
and callbacks through props, so they stay reusable and easy to preview in Storybook.

## SSR and the Provider

- **Keep the root `<Provider>`.** Without it, Jotai falls back to one module-level default store. On the server that
  store is shared by every request, so one user's state could leak into another user's render. Don't call
  `getDefaultStore()` either, for the same reason.
- **Seeding from server data** is rarely needed: read the query directly. When an atom must start from a server
  value, call `useHydrateAtoms([[atom, value]])` at the top of the route component. Hydration happens only once per
  store, so later refetches won't update the atom.

## Utilities

All of these are imported from `jotai/utils`.

- **`atomWithStorage`** saves the value to `localStorage`. On the server and during hydration the atom returns its
  `initialValue`, so render UI that depends on the stored value only after hydration, or you'll get a hydration
  mismatch. Never store secrets or tokens in it.
- **`atomWithReset`** with `RESET` / `useResetAtom` gives state a default it can return to (for example, clearing a
  wizard).
- **`selectAtom` and `splitAtom`** optimize re-renders. Use them only after you've measured a real re-render problem.
- **`atomFamily`** is not in Jotai v3's `jotai/utils`. If you truly need parameterized atoms, use the `jotai-family`
  package, and remove params you no longer need so memory doesn't grow without limit.

## Don'ts

- Don't fetch server data with async atoms. TanStack Query handles caching, refetching, and errors.
- Don't create one large "app state" atom. Separate atoms keep re-renders local.
- Don't use Jotai for state that only one subtree uses. `useState` and props are simpler.

## Testing

Test the behavior the user sees, through the components. To test logic in action atoms on its own, create a store with
`createStore()` and drive it with `store.set` / `store.get`. Don't test Jotai itself.
