# Pretranslation (LLM/MT Seeding)

Pretranslation runs in the background to seed draft translations for each file-language pair when a translation engine is configured.

## Engine resolution order

The effective engine for a file/target language pair is resolved in this order:

1. File + target override (if set)
2. Target default
3. Project default
4. None (skip)

## Project settings (persisted)

Project settings can store a translation engine matrix:

- `translation_engine_default_id`: project default engine ID (nullable)
- `translation_engine_defaults_by_target`: `{ [targetLang]: engineId | null }`
- `translation_engine_overrides`: `{ [fileId]: { [targetLang]: engineId | null } }`
- `mt_seeding_enabled`: boolean flag to enable/disable MT/LLM pretranslation
- `mt_run_after_create`: boolean flag to request seeding immediately after project creation

## API

### Enqueue jobs

`POST /api/cat/projects/:id/pretranslate`

Payload:

```
{
  "scope": "all" | "file" | "language",
  "fileId": 123,          // required when scope="file"
  "targetLang": "fr",      // required when scope="language"
  "overwrite": false       // optional; default false
}
```

### Status

`GET /api/cat/projects/:id/pretranslate/status`

Returns a summary and per-file/target job details, including status and error messages.
