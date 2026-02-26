# FastCat Acceptance Checklist

## Admin Language Settings
- Save blocked when default source is missing, not enabled, or targets are empty or include source.
- Save blocked when fewer than two enabled languages and single-language mode is off.

## Termbase Wizard
- Languages list only includes admin-enabled languages.
- Default source/target are prefilled from org language settings and cannot select disabled languages.

## Termbase Import
- Strict ON rejects unknown language codes (import fails with clear error).
- Strict OFF proceeds and reports warnings for unknown languages.
- Duplicate handling: Ignore, Merge, Overwrite behaves as selected.
- Picklist values: strict ON errors for unknown values; strict OFF auto-extends and warns.
