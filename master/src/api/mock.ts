import Router from "koa-router";

const router = new Router({
  prefix: "/mock",
});

router.post("/", async (ctx) => {
  
  ctx.body = "received request";
});

export default router;
