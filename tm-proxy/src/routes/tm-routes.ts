import type { FastifyInstance } from "fastify";

import {
  addToTM,
  searchTMConcordance,
  searchTM,
  getAllEntries,
  getAllEntriesCursor,
  listTMs,
  createTM,
  deleteTM,
  getTM,
  getTMEntryCount,
  tmEntryExists
} from "../t5memory.js";
import { parseTMX } from "../tmx.js";
import { authenticate, requireAdmin } from "../auth.js";

export function registerTmRoutes(app: FastifyInstance) {
  app.get("/api/tms", async () => {
    const tms = await listTMs();
    return { tms };
  });

  app.post("/api/tms", { preHandler: [authenticate] }, async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin) return admin;
    const body = (req.body as any) || {};
    const { name, description } = body;
    if (!name || typeof name !== "string") {
      return reply.code(400).send({ error: "name required" });
    }

    try {
      const tm = await createTM(name, description);
      return { tm };
    } catch (err: any) {
      if (String(err.message || "").includes("UNIQUE")) {
        return reply.code(409).send({ error: "TM with this name already exists" });
      }
      throw err;
    }
  });

  app.delete("/api/tms/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (admin) return admin;
    const { id } = req.params as any;
    const tmId = Number(id);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }

    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }

    await deleteTM(tmId);
    return { ok: true };
  });

  app.post("/api/tm/:tmId/search", async (req, reply) => {
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }

    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }

    const body = (req.body as any) || {};
    const { sourceLang, targetLang, text, limit } = body;

    if (!sourceLang || !targetLang || typeof text !== "string") {
      return reply.code(400).send({ error: "sourceLang, targetLang, text required" });
    }

    const matches = await searchTM(
      tmId,
      String(sourceLang),
      String(targetLang),
      text,
      limit ?? 10
    );

    return { matches };
  });

  app.get("/api/tm/:tmId/concordance", async (req, reply) => {
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }
    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }

    const query = (req.query as any) || {};
    const sourceLang = String(query.sourceLang || "").trim();
    const targetLang = String(query.targetLang || "").trim();
    const q = String(query.q || "").trim();
    const modeRaw = String(query.mode || "source").trim().toLowerCase();
    const mode = modeRaw === "target" || modeRaw === "both" ? modeRaw : "source";
    const limit = Number(query.limit ?? 20);

    if (!sourceLang || !targetLang || !q) {
      return reply.code(400).send({ error: "sourceLang, targetLang and q are required" });
    }

    const entries = await searchTMConcordance(tmId, sourceLang, targetLang, q, mode, limit);
    return { entries };
  });

  app.get("/api/tm/:tmId/info", async (req, reply) => {
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }

    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }
    const entryCount = await getTMEntryCount(tmId);
    return { tm, entryCount };
  });

  app.post("/api/tm/:tmId/check-duplicate", async (req, reply) => {
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }

    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }

    const body = (req.body as any) || {};
    const { sourceLang, targetLang, source, target } = body;
    if (
      !sourceLang ||
      !targetLang ||
      typeof source !== "string" ||
      typeof target !== "string"
    ) {
      return reply.code(400).send({
        error: "sourceLang, targetLang, source, target required"
      });
    }

    const exists = await tmEntryExists(
      tmId,
      String(sourceLang),
      String(targetLang),
      source,
      target
    );
    return { exists };
  });

  app.post("/api/tm/:tmId/commit", { preHandler: [authenticate] }, async (req, reply) => {
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }

    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }

    const body = (req.body as any) || {};
    const { sourceLang, targetLang, source, target } = body;

    if (!sourceLang || !targetLang || !source || !target) {
      return reply
        .code(400)
        .send({ error: "sourceLang, targetLang, source, target required" });
    }

    await addToTM(tmId, sourceLang, targetLang, source, target);
    return { ok: true };
  });

  app.get("/api/tm/:tmId/entries", { preHandler: [authenticate] }, async (req, reply) => {
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }

    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }

    const query = (req.query as any) || {};
    const sourceLang = query.sourceLang as string | undefined;
    const targetLang = query.targetLang as string | undefined;

    const entries = await getAllEntries(tmId, sourceLang, targetLang);
    return { entries, count: entries.length };
  });

  app.get("/api/tm/:tmId/export", async (req, reply) => {
    const authed = await authenticate(req, reply);
    if (authed) return authed;
    const admin = await requireAdmin(req, reply);
    if (admin) return admin;
    const { tmId: tmIdRaw } = req.params as any;
    const tmId = Number(tmIdRaw);
    if (!Number.isFinite(tmId)) {
      return reply.code(400).send({ error: "invalid TM id" });
    }
    const tm = await getTM(tmId);
    if (!tm) {
      return reply.code(404).send({ error: "TM not found" });
    }
    const entries = await getAllEntriesCursor(tmId);
    const body = entries
      .map((entry) => {
        const src = escapeXml(entry.source);
        const tgt = escapeXml(entry.target);
        return `    <tu>
      <tuv xml:lang="${entry.sourceLang}"><seg>${src}</seg></tuv>
      <tuv xml:lang="${entry.targetLang}"><seg>${tgt}</seg></tuv>
    </tu>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="tm-lite" creationtoolversion="1.0" datatype="PlainText" segtype="sentence" adminlang="en-US" srclang="${escapeXml(
    entries[0]?.sourceLang || "en"
  )}" o-tmf="tm-lite"/>
  <body>
${body}
  </body>
</tmx>`;
    const filename = `${tm.name.replace(/[^a-z0-9]/gi, "_")}.tmx`;
    reply.header("Content-Type", "application/xml");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(xml);
  });

  app.post(
    "/api/tm/:tmId/import",
    { preHandler: [authenticate, requireAdmin] },
    async (req, reply) => {
      const { tmId: tmIdRaw } = req.params as any;
      const tmId = Number(tmIdRaw);
      if (!Number.isFinite(tmId)) {
        return reply.code(400).send({ error: "invalid TM id" });
      }

      const tm = await getTM(tmId);
      if (!tm) {
        return reply.code(404).send({ error: "TM not found" });
      }

      const data = await (req as any).file();
      if (!data) {
        return reply.code(400).send({ error: "No file uploaded" });
      }

      const buffer = await data.toBuffer();
      const xml = buffer.toString("utf-8");

      try {
        const units = parseTMX(xml);
        let imported = 0;
        let skipped = 0;

        for (const unit of units) {
          if (unit.source && unit.target && unit.sourceLang && unit.targetLang) {
            await addToTM(tmId, unit.sourceLang, unit.targetLang, unit.source, unit.target);
            imported++;
          } else {
            skipped++;
          }
        }

        app.log.info(`TMX Import into TM ${tmId}: ${imported} imported, ${skipped} skipped`);
        return {
          ok: true,
          imported,
          skipped,
          total: units.length,
          filename: data.filename,
          tmId
        };
      } catch (err: any) {
        app.log.error(err);
        return reply.code(500).send({ error: "Failed to parse TMX: " + err.message });
      }
    }
  );
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
