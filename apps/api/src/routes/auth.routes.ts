import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as auth from "../controllers/auth.controller";
import * as user from "../controllers/user.controller";

export const authPublicRoutes = new Elysia()
  .get("/v1/auth/setup-status", () => auth.setupStatus())
  .post("/v1/auth/setup", ({ body, set }) => auth.setup({ body, set }), {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      email: t.String(),
      password: t.String({ minLength: 6 }),
    }),
  })
  .post("/v1/auth/login", ({ body, set }) => auth.login({ body, set }), {
    body: t.Object({
      username: t.String(),
      password: t.String(),
      totpCode: t.Optional(t.String()),
    }),
  });

export const authProtectedRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .post("/auth/logout", ({ request }) => auth.logout({ request }))
  .get("/auth/me", ({ store }) => auth.me({ store }))
  // usuários (owner)
  .get("/users", ({ store, set }) => user.listUsers({ store, set }))
  .post("/users", ({ store, set, body }) => user.createUser({ store, set, body }), {
    body: t.Object({
      email: t.String(),
      name: t.String(),
      password: t.String({ minLength: 6 }),
      isOwner: t.Optional(t.Union([t.Literal(0), t.Literal(1)])),
    }),
  })
  .delete("/users/:id", ({ store, set, params }) => user.deleteUser({ store, set, params }))
  // api tokens
  .get("/api-tokens", ({ store }) => user.listTokens({ store }))
  .post("/api-tokens", ({ store, set, body }) => user.createToken({ store, set, body }), {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }) }),
  })
  .delete("/api-tokens/:id", ({ store, set, params }) => user.deleteToken({ store, set, params }))
  // 2FA
  .post("/auth/2fa/enable", ({ store }) => user.enable2fa({ store }))
  .post("/auth/2fa/confirm", ({ store, set, body }) => user.confirm2fa({ store, set, body }), {
    body: t.Object({ code: t.String() }),
  })
  .post("/auth/2fa/disable", ({ store, set, body }) => user.disable2fa({ store, set, body }), {
    body: t.Object({ code: t.String() }),
  })
  .post(
    "/auth/change-password",
    ({ store, set, body }) => user.changePassword({ store, set, body }),
    {
      body: t.Object({
        currentPassword: t.String(),
        newPassword: t.String({ minLength: 6 }),
      }),
    },
  );
