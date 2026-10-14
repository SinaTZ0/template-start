import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/site_layout/site-layout.tsx", [
    index("routes/home/home.tsx"),
    route("auth", "routes/auth/auth.tsx"),
    layout("routes/notes_layout/notes-layout.tsx", [route("notes", "routes/notes/notes.tsx")]),
  ]),

  /*===== Resource Routes =====*/
  route("api/auth/*", "routes/api_auth/api-auth.ts"),
  route("rpc/*", "routes/rpc/rpc.ts"),
] satisfies RouteConfig;
