import { HTTPParamException } from "../exceptions/exception";
import Router from "koa-router";

const router = new Router({
  prefix: "/crawler",
});

router.post("/", async (ctx) => {
  const url = ctx.request.body.url;
  if (!url || typeof url !== "string") {
    throw new HTTPParamException();
  }
  await global.resourceManager.urlMQ.put(url);
  ctx.body = "received request";
});

export default router;
