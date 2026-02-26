import { FastifyInstance } from "fastify";
import { db, withTransaction } from "../db.js";
import { CONFIG } from "../config.js";
import {
  requireAuth,
  requireManagerOrAdmin,
  requestUserId,
  getRequestUser
} from "../middleware/auth.js";
import {
  parseGlossaryFile,
  buildGlossaryTbx,
  ParsedGlossaryEntry
} from "../lib/glossary-utils.js";
import fs from "fs";
import path from "path";

export async function seedGlobalGlossary(log: any) {
  const countRes = await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM global_glossary_entries"
  );
  const count = countRes.rows[0]?.count ?? 0;
  if (count > 0) return;
  if (!fs.existsSync(CONFIG.GLOSSARY_DIR)) {
    log.info("[glossary] No TBX directory configured.");
    return;
  }
  const candidates = fs
    .readdirSync(CONFIG.GLOSSARY_DIR)
    .filter((file) => file.toLowerCase().endsWith(".tbx"))
    .sort();
  if (candidates.length === 0) {
    log.info("[glossary] No TBX file found. Starting with empty glossary.");
    return;
  }
  const filePath = path.join(CONFIG.GLOSSARY_DIR, candidates[0]);
  try {
    const entries = await parseGlossaryFile(filePath);
    await insertGlossaryEntries(entries, path.basename(filePath));
    log.info({ file: filePath, count: entries.length }, "[glossary] Seeded database from TBX");
  } catch (err) {
    log.error({ err, file: filePath }, "[glossary] Failed to seed glossary file");
  }
}

async function insertGlossaryEntries(
  entries: ParsedGlossaryEntry[],
  originLabel: string | null
) {
  if (entries.length === 0) return;

  const CHUNK_SIZE = 500;

  await withTransaction(async (client) => {
    for (let offset = 0; offset < entries.length; offset += CHUNK_SIZE) {
      const chunk = entries.slice(offset, offset + CHUNK_SIZE);
      const params: any[] = [];
      const valuesSql = chunk
        .map((entry, i) => {
          const base = i * 10;
          params.push(
            entry.sourceLang ?? null,
            entry.targetLang ?? null,
            entry.term,
            entry.translation,
            entry.createdBy ?? entry.originAuthor ?? "system",
            entry.sourceType ?? "origination",
            entry.origin ?? originLabel ?? null,
            entry.createdAt ?? entry.originDate ?? new Date().toISOString(),
            entry.originAuthor ?? entry.createdBy ?? null,
            entry.originDate ?? entry.createdAt ?? null
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        })
        .join(", ");

      await client.query(
        `INSERT INTO global_glossary_entries
          (source_lang, target_lang, term, translation, created_by, source_type, origin, created_at, origin_author, origin_date)
         VALUES ${valuesSql}
         ON CONFLICT (term, translation, source_lang, target_lang) DO NOTHING`,
        params
      );
    }
  });
}

function rowToGlossaryEntry(row: any) {
  return {
    id: row.id,
    sourceLang: row.source_lang,
    targetLang: row.target_lang,
    term: row.term,
    translation: row.translation,
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    sourceType: (row.source_type || "origination") as "origination" | "modification",
    origin: row.origin,
    originAuthor: row.origin_author,
    originDate: row.origin_date
  };
}

export async function glossaryRoutes(app: FastifyInstance) {
  app.get("/glossary/search", { preHandler: [requireAuth] }, async (req) => {
    const query = String(((req.query as any) || {}).q || "").trim();
    if (!query) return { entries: [] };
    const like = `%${query.toLowerCase()}%`;
    const res = await db.query(
      `SELECT *
       FROM global_glossary_entries
       WHERE LOWER(term) LIKE $1 OR LOWER(translation) LIKE $1
       ORDER BY LENGTH(term) ASC, LOWER(term), term
       LIMIT 50`,
      [like]
    );
    const rows = res.rows;
    return { entries: rows.map(rowToGlossaryEntry) };
  });

  app.get("/admin/global-glossary", { preHandler: [requireManagerOrAdmin] }, async () => {
    const res = await db.query(
      "SELECT * FROM global_glossary_entries ORDER BY LOWER(term), term"
    );
    const rows = res.rows;
    return {
      entries: rows.map(rowToGlossaryEntry),
      meta: {
        entryCount: rows.length,
        activeFile: null
      }
    };
  });

  app.post("/admin/global-glossary", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const body = (req.body as any) || {};
    const { sourceLang, targetLang, term, translation } = body;
    if (!sourceLang || !targetLang || !term || !translation) {
      return reply.code(400).send({ error: "Missing required fields" });
    }
    const normalizedSrc = String(sourceLang).trim().toLowerCase();
    const normalizedTgt = String(targetLang).trim().toLowerCase();
    const termValue = String(term).trim();
    const translationValue = String(translation).trim();
    if (!termValue || !translationValue) {
      return reply.code(400).send({ error: "Term and translation cannot be empty" });
    }
    const now = new Date().toISOString();
    const actorId = requestUserId(getRequestUser(req)) || "system";
    try {
      const insertRes = await db.query(
        `INSERT INTO global_glossary_entries
          (source_lang, target_lang, term, translation, created_by, source_type, origin, created_at, origin_author, origin_date)
         VALUES ($1, $2, $3, $4, $5, 'origination', $6, $7, $8, $9)
         RETURNING *`,
        [
          normalizedSrc,
          normalizedTgt,
          termValue,
          translationValue,
          actorId,
          "web-admin",
          now,
          actorId,
          now
        ]
      );
      return reply.code(201).send({ entry: rowToGlossaryEntry(insertRes.rows[0]) });
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "Duplicate entry" });
      }
      throw err;
    }
  });

  app.patch("/admin/global-glossary/:id", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const { id } = req.params as any;
    const entryId = Number(id);
    if (!Number.isFinite(entryId)) {
      return reply.code(400).send({ error: "Invalid entry id" });
    }
    const existingRes = await db.query(
      "SELECT * FROM global_glossary_entries WHERE id = $1",
      [entryId]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      return reply.code(404).send({ error: "Entry not found" });
    }
    const body = (req.body as any) || {};
    const updates: string[] = [];
    const values: any[] = [];

    const assign = (
      key: string,
      column: string,
      opts: { lower?: boolean } = {}
    ) => {
      if (body[key] === undefined) return;
      const value = String(body[key]).trim();
      if (!value) {
        throw new Error(`${key} cannot be empty`);
      }
      values.push(opts.lower ? value.toLowerCase() : value);
      updates.push(`${column} = $${values.length}`);
    };

    try {
      assign("sourceLang", "source_lang", { lower: true });
      assign("targetLang", "target_lang", { lower: true });
      assign("term", "term");
      assign("translation", "translation");
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || "Invalid update" });
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: "No updates" });
    }

    const modifiedBy = requestUserId(getRequestUser(req)) || "admin";
    const modifiedAt = new Date().toISOString();
    updates.push("source_type = 'modification'");
    values.push(modifiedBy);
    updates.push(`created_by = $${values.length}`);
    values.push(modifiedAt);
    updates.push(`created_at = $${values.length}`);

    values.push(entryId);

    try {
      const updateRes = await db.query(
        `UPDATE global_glossary_entries
         SET ${updates.join(", ")}
         WHERE id = $${values.length}
         RETURNING *`,
        values
      );
      return { entry: rowToGlossaryEntry(updateRes.rows[0]) };
    } catch (err: any) {
      if (err?.code === "23505") {
        return reply.code(409).send({ error: "Duplicate entry" });
      }
      throw err;
    }
  });

  app.delete("/admin/global-glossary/:id", { preHandler: [requireManagerOrAdmin] }, async (req, reply) => {
    const { id } = req.params as any;
    const entryId = Number(id);
    if (!Number.isFinite(entryId)) {
      return reply.code(400).send({ error: "Invalid entry id" });
    }
    const result = await db.query(
      "DELETE FROM global_glossary_entries WHERE id = $1",
      [entryId]
    );
    if (result.rowCount === 0) {
      return reply.code(404).send({ error: "Entry not found" });
    }
    return { ok: true };
  });

  app.get("/admin/global-glossary/download", { preHandler: [requireManagerOrAdmin] }, async (_, reply) => {
    const rowsRes = await db.query(
      "SELECT * FROM global_glossary_entries ORDER BY LOWER(term), term"
    );
    const rows = rowsRes.rows;
    const xml = buildGlossaryTbx(rows);
    reply.header("Content-Type", "application/xml");
    reply.header("Content-Disposition", `attachment; filename="glossary-export.tbx"`);
    return reply.send(xml);
  });
}
