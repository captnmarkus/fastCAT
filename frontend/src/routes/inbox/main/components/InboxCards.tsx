import React from "react";
import { formatDateTimeShort, formatRelativeTime } from "../../../projects/shared/dates";
import LanguagePair from "../../../projects/shared/components/LanguagePair";
import ProgressBar from "../../../projects/shared/components/ProgressBar";
import StatusPill from "../../../projects/shared/components/StatusPill";
import type { InboxRow } from "../types";
import { labelForInboxStatus, toneForInboxStatus } from "../../shared/status";

type Props = {
  rows: InboxRow[];
  selectedIds: Set<number>;
  onToggleSelected: (taskId: number) => void;
};

export default function InboxCards({ rows, selectedIds, onToggleSelected }: Props) {
  return (
    <div className="row g-3 fc-project-card-grid">
      {rows.map((row) => {
        const checked = selectedIds.has(row.taskId);
        const total = Number(row.segmentStats?.total ?? 0) || 0;
        const reviewed = Number(row.segmentStats?.reviewed ?? 0) || 0;
        const pct = total > 0 ? Math.round((reviewed / total) * 100) : row.progressPct ?? 0;
        const updatedAt = row.modifiedAt || row.createdAt;
        return (
          <div className="col-12 col-lg-6 col-xxl-4" key={row.taskId}>
            <article
              className={`card-enterprise h-100 fc-project-card${checked ? " selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleSelected(row.taskId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleSelected(row.taskId);
                }
              }}
              aria-pressed={checked}
              aria-label={`Select task ${row.originalFilename}`}
            >
              <div className="card-body fc-project-card-body">
                <div className="fc-project-card-top">
                  <div className="d-flex align-items-start gap-2">
                    <input
                      className="form-check-input mt-0"
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelected(row.taskId)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select task ${row.originalFilename}`}
                    />
                    <div className="fc-project-card-title-wrap">
                      <h3 className="fc-project-card-title">{row.originalFilename}</h3>
                      <div className="fc-project-card-meta">
                        #{row.fileId} - {row.projectName}
                      </div>
                    </div>
                  </div>
                  <StatusPill label={labelForInboxStatus(row.status)} tone={toneForInboxStatus(row.status)} />
                </div>

                <div className="fc-project-card-section">
                  <span className="fc-project-card-label">Languages</span>
                  <LanguagePair srcLang={row.srcLang} tgtLang={row.tgtLang} />
                </div>

                <div className="fc-project-card-section">
                  <span className="fc-project-card-label">Progress</span>
                  <ProgressBar percent={pct} />
                </div>

                <div className="fc-project-card-metrics" aria-label={`Task metadata for ${row.originalFilename}`}>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Type</span>
                    <span className="fc-project-card-value">{String(row.type || "").toUpperCase() || "-"}</span>
                  </div>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Usage</span>
                    <span className="fc-project-card-value">{row.usage || "-"}</span>
                  </div>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Updated</span>
                    <span className="fc-project-card-value">{formatDateTimeShort(updatedAt)}</span>
                  </div>
                  <div className="fc-project-card-metric">
                    <span className="fc-project-card-label">Relative</span>
                    <span className="fc-project-card-value">{formatRelativeTime(updatedAt)}</span>
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
