import { FastifyInstance } from "fastify";
import { registerSegmentBulkRoutes } from "./segments.bulk-routes.js";
import { registerSegmentMutationRoutes } from "./segments.mutation-routes.js";

export { setBroadcaster } from "./segments.shared.js";

export async function segmentRoutes(app: FastifyInstance) {
  await registerSegmentMutationRoutes(app);
  await registerSegmentBulkRoutes(app);
}
