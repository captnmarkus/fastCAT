# UI Tokens and Design Rules (2026 Refresh)

## Goals
- One visual language across project creation, resource wizards, and filter sidebars.
- Calm black/white core with neutral grays and reserved semantic accents.
- Consistent spacing rhythm, typography, control sizes, and validation behavior.

## Core Tokens
- Typography:
  - `--fc-font-sans`: `"Suisse Intl", "IBM Plex Sans", "Manrope", "Segoe UI", sans-serif`
  - `--fc-font-mono`: `"JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", Consolas, monospace`
- Spacing scale:
  - `--fc-space-1` to `--fc-space-8` (`0.25rem` to `2.5rem`)
- Radius:
  - `--fc-radius-sm`, `--fc-radius-md`, `--fc-radius-lg`, `--fc-radius-pill`
- Shadows:
  - `--fc-shadow-xs`, `--fc-shadow-sm`, `--fc-shadow-focus`
- Surfaces:
  - `--fc-bg-canvas`, `--fc-bg-surface`, `--fc-bg-muted`, `--fc-bg-muted-2`
- Borders/text:
  - `--fc-border-subtle`, `--fc-border-strong`, `--fc-text-main`, `--fc-text-muted`, `--fc-text-soft`
- Semantic accents:
  - `--fc-success-*`, `--fc-warning-*`, `--fc-error-*`, `--fc-info-*`
- Controls:
  - `--fc-control-height`, `--fc-toolbar-height`

## Shared Components
- `WizardShell`: unified page header, stepper, alert area, main surface, sticky footer actions.
- `SectionCard`: reusable card section with optional title/description/actions.
- `StepHeader`: standardized step title/description/action row.
- `FieldRow`: normalized label/help/error/control structure.
- `WarningBanner`: consistent warning/error/info/success banner.
- `EmptyState`: standard empty-state presentation.
- `FilterSidebar` + `FilterSection`: reusable collapsible filter rail and grouped sections.

## Interaction Rules
- Focus:
  - Keyboard focus uses a high-contrast ring (`--fc-shadow-focus`) on buttons, inputs, selects, toggles, and stepper items.
- Validation:
  - Errors are shown inline under controls; page-level issues use `WarningBanner`.
- Step navigation:
  - Completed steps are clickable; active step is always visibly distinct.
- Density:
  - Inputs/selects normalized to `--fc-control-height`.
  - Table headers are uppercase, compact, and muted for clearer hierarchy.
- Empty/loading:
  - Empty lists/panels use `EmptyState`.
  - In-progress states show semantic info banners or local progress labels.

## Applied Areas
- Project create flow:
  - `ProjectsCreatePage` and step sections (`TMX`, `Translation Engine`, `Rules`, `Termbase/Glossary`).
- Resource wizards:
  - File Type Config, Project Template, Translation Engine, Translation Memory, Ruleset, Termbase, NMT Provider.
- Filters:
  - Project filters and Inbox filters migrated to `FilterSidebar`/`FilterSection`.

## Screenshot Targets
- Before/after capture targets:
  - `projects/create` (all steps)
  - `resources/file-types/new`
  - `resources/templates/new`
  - `resources/translation-engines/new`
  - `projects` filter sidebar
  - `inbox` filter sidebar
