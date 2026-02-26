# App Agent: Debugging "0 Segments"

Use this checklist when a project is created but the editor shows no segments.

1. Check project provisioning state
- Open `Projects -> <Project> -> Provisioning`.
- Verify project status: `provisioning`, `ready`, or `failed`.
- If `ready` with zero segments, treat as import failure and retry import.

2. Check per-file processing status
- In provisioning view, review each file status (`QUEUED`, `PROCESSING`, `READY`, `FAILED`).
- Confirm segment counts per file are greater than zero for `READY` files.

3. Inspect processing logs
- In provisioning `Logs / Status`, inspect recent entries by stage (`IMPORT`, `PARSE`, `SEGMENT`).
- Look for messages such as:
  - missing source artifact,
  - unsupported type/template,
  - parse/conversion errors,
  - `No segments extracted`.

4. Retry import
- Use **Retry import** from provisioning/editor error state.
- This rehydrates agent-mapped source files and re-runs provisioning.

5. Verify source file health
- Ensure selected source file IDs belong to the current user.
- Confirm source files have valid artifacts and/or source segments.
- If source files themselves have zero segments, re-upload or fix file type template config.

6. Validate global language config
- App Agent language validation uses global Language Settings.
- Ensure requested source/targets are enabled there.

7. Confirm editor visibility
- New editor load auto-resets stale filters when they hide all segments.
- Header now shows `visible/total` segment counts.

8. Last-mile checks
- If repeated failures persist, capture:
  - project ID,
  - file IDs,
  - latest provisioning logs,
  - import retry outcome.
- Then debug parser/template mapping for that file type.
