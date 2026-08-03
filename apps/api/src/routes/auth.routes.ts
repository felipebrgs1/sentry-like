import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as auth from "../controllers/auth.controller";

export const authPublicRoutes = new Elysia({ prefix: "/v1/auth" }).post(
  "/login",
  ({ body, set }) => auth.login({ body, set }),
  { body: t.Object({ username: t.String(), password: t.String() }) },
);

export const authProtectedRoutes = new Elysia({ prefix: "/v1/auth" })
  .onBeforeHandle(authGuard)
  .post("/logout", ({ request }) => auth.logout({ request }))
  .get("/me", () => auth.me());
