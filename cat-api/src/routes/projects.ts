import { FastifyInstance } from "fastify";
import { registerProjectRoutesPart1 } from "./projects.routes.part1.js";
import { registerProjectRoutesPart2 } from "./projects.routes.part2.js";
import { registerProjectRoutesPart3 } from "./projects.routes.part3.js";
import { registerProjectRoutesPart4 } from "./projects.routes.part4.js";
import { registerProjectRoutesPart5 } from "./projects.routes.part5.js";
import { registerProjectRoutesPart6 } from "./projects.routes.part6.js";

export async function projectRoutes(app: FastifyInstance) {
  await registerProjectRoutesPart1(app);
  await registerProjectRoutesPart2(app);
  await registerProjectRoutesPart3(app);
  await registerProjectRoutesPart4(app);
  await registerProjectRoutesPart5(app);
  await registerProjectRoutesPart6(app);
}


export { insertSegments, insertSegmentsForFile } from "./projects.segment-insert.js";
