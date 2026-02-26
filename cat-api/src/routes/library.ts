import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { listTmSamples } from "./tm-library.js";

export async function libraryRoutes(app: FastifyInstance) {
  app.get("/library/tm-samples", { preHandler: [requireAuth] }, async () => {
    const samples = await listTmSamples();
    return { samples };
  });
}
