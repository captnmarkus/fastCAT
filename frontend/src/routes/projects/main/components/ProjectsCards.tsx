import React from "react";
import type { ProjectRow } from "../types";
import LanguagePair from "../../shared/components/LanguagePair";
import ProgressBar from "../../shared/components/ProgressBar";
import StatusPill from "../../shared/components/StatusPill";
import { formatDateTimeShort } from "../../shared/dates";

type Props = {
  rows: ProjectRow[];
  selectedIds: Set<number>;
  onToggleSelected: (id: number) => void;
};

export default function ProjectsCards({ rows, selectedIds, onToggleSelected }: Props) {
  function formatProvisioningStep(value: string | null) {
    const raw = String(value || "").trim();
    if (!raw) return "Preparing...";
    return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  return (
    <div className="row g-3 fc-project-card-grid">
      {rows.map((row) => {
        const p = row.project;
        const checked = selectedIds.has(p.id);
        const isOverdue = row.overdueDays != null && row.overdueDays > 0;
        const hasErrors = row.errorCount > 0;
        return (
          <div className="col-12 col-lg-6 col-xxl-4" key={p.id}>
            <article
              className={`card-enterprise h-100 fc-project-card${checked ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleSelected(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleSelected(p.id);
                }
              }}
              aria-pressed={checked}
              aria-label={`Select project ${p.name}`}
            >
              <div className="card-body fc-project-card-body">
                <div className="fc-project-card-top">
                  <div className="d-flex align-items-start gap-2">
                    <input
                      className="form-check-input mt-0"
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelected(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select project ${p.name}`}
                    />
                    <div className="fc-project-card-title-wrap">
                      <h3 className="fc-project-card-title">{p.name}</h3>
                      <div className="fc-project-card-meta">
                        #{p.id} - {row.ownerLabel}
                      </div>
                    </div>
                  </div>
                  <StatusPill label={row.statusLabel} tone={row.statusTone} />
                </div>

                <div className="fc-project-card-section">
                  <span className="fc-project-card-label">Languages</span>
                  <LanguagePair srcLang={p.srcLang} tgtLang={p.tgtLang} targetLangs={p.targetLangs} />
                </div>

                <div className="fc-project-card-section">
                  <span className="fc-project-card-label">Progress</span>
                  <ProgressBar percent={row.progressPct} />
                  {row.isProvisioning ? (
                    <div className="text-muted small mt-1">
                      {formatProvisioningStep(row.provisioningStep)}
                      {row.provisioningUpdatedAt ? ` • Last update: ${formatDateTimeShort(row.provisioningUpdatedAt)}` : ""}
                    </div>
                  ) : null}
                </div>

                <div className="fc-project-card-metrics" aria-label={`Project metadata for ${p.name}`}>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Overdue</span>
                    <span className={`fc-project-card-value${isOverdue ? " is-danger" : ""}`}>
                      {isOverdue ? `+${row.overdueDays}d` : "-"}
                    </span>
                  </div>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Errors</span>
                    <span className={`fc-project-card-value${hasErrors ? " is-danger" : ""}`}>
                      {row.errorCount}
                    </span>
                  </div>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Due</span>
                    <span className="fc-project-card-value">{formatDateTimeShort(row.dueAt)}</span>
                  </div>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Last modified</span>
                    <span className="fc-project-card-value">{formatDateTimeShort(row.lastModifiedAt)}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}
