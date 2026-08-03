import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as auth from "../controllers/auth.controller";

export const authPublicRoutes = new Elysia({ prefix: "/v1/auth" }).post(
  "/login",
  auth.login,
  { body: t.Object({ username: t.String(), password: t.String() }) },
);

export const authProtectedRoutes = new Elysia({ prefix: "/v1/auth" })
  .onBeforeHandle(authGuard)
  .post("/logout", auth.logout)
  .get("/me", auth.me);
