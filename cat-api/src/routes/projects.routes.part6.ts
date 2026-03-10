import { FastifyInstance } from "fastify";
import { registerProjectRoutesPart6Exports } from "./projects.routes.part6.exports.js";
import { registerProjectRoutesPart6RenderedPreview } from "./projects.routes.part6.rendered-preview.js";

export async function registerProjectRoutesPart6(app: FastifyInstance) {
  await registerProjectRoutesPart6Exports(app);
  await registerProjectRoutesPart6RenderedPreview(app);
}
