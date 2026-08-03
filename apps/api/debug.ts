import { Elysia } from "elysia";

const guard = new Elysia().onBeforeHandle(
  { as: "scoped" },
  ({ set }) => {
    console.log("[guard] RODOU");
    set.status = 401;
    return "bloqueado";
  },
);

const app = new Elysia()
  .get("/public", () => "public ok")
  .use(
    new Elysia({ prefix: "/v1" })
      .use(guard)
      .get("/a", () => "a ok"),
  )
  .use(
    new Elysia({ prefix: "/v1" })
      .use(guard)
      .get("/b", () => "b ok"),
  )
  .get("/v1/c", () => "c ok")
  .listen(3997);

console.log("listening 3997");
