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
  .get("/auth/me", ({ request }) => auth.me({ request }))
  // usuários (owner)
  .get("/users", ({ request, set }) => user.listUsers({ request, set }))
  .post("/users", ({ request, set, body }) => user.createUser({ request, set, body }), {
    body: t.Object({
      email: t.String(),
      name: t.String(),
      password: t.String({ minLength: 6 }),
      isOwner: t.Optional(t.Union([t.Literal(0), t.Literal(1)])),
    }),
  })
  .delete("/users/:id", ({ request, set, params }) => user.deleteUser({ request, set, params }))
  // api tokens
  .get("/api-tokens", ({ request }) => user.listTokens({ request }))
  .post("/api-tokens", ({ request, set, body }) => user.createToken({ request, set, body }), {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }) }),
  })
  .delete("/api-tokens/:id", ({ request, set, params }) =>
    user.deleteToken({ request, set, params }),
  )
  // 2FA
  .post("/auth/2fa/enable", ({ request }) => user.enable2fa({ request }))
  .post("/auth/2fa/confirm", ({ request, set, body }) => user.confirm2fa({ request, set, body }), {
    body: t.Object({ code: t.String() }),
  })
  .post("/auth/2fa/disable", ({ request, set, body }) => user.disable2fa({ request, set, body }), {
    body: t.Object({ code: t.String() }),
  })
  .post(
    "/auth/change-password",
    ({ request, set, body }) => user.changePassword({ request, set, body }),
    {
      body: t.Object({
        currentPassword: t.String(),
        newPassword: t.String({ minLength: 6 }),
      }),
    },
  );
