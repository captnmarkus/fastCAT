import React from "react";
import type { SortDir, SortKey, ProjectRow } from "../types";
import { formatDateTimeShort } from "../../shared/dates";
import LanguagePair from "../../shared/components/LanguagePair";
import ProgressBar from "../../shared/components/ProgressBar";
import StatusPill from "../../shared/components/StatusPill";
import BadgePill from "../../../../components/ui/BadgePill";

type Props = {
  rows: ProjectRow[];
  selectedIds: Set<number>;
  selectAllRef: React.RefObject<HTMLInputElement>;
  onToggleSelected: (id: number) => void;
  onToggleSelectAllVisible: () => void;
  onSetSort: (key: SortKey) => void;
  sortKey: SortKey;
  sortDir: SortDir;
};

export default function ProjectsTable({
  rows,
  selectedIds,
  selectAllRef,
  onToggleSelected,
  onToggleSelectAllVisible,
  onSetSort
}: Props) {
  function formatProvisioningStep(value: string | null) {
    const raw = String(value || "").trim();
    if (!raw) return "Preparing...";
    return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  return (
    <div className="card-enterprise">
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-0 fc-table-compact">
          <thead className="table-light">
            <tr>
              <th style={{ width: 32 }}>
                <input
                  ref={selectAllRef}
                  className="form-check-input"
                  type="checkbox"
                  onChange={onToggleSelectAllVisible}
                  aria-label="Select all projects"
                />
              </th>
              <th>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("name")}
                >
                  Name
                </button>
              </th>
              <th style={{ width: 160 }}>Languages</th>
              <th style={{ width: 190 }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("progress")}
                >
                  Progress
                </button>
              </th>
              <th style={{ width: 90 }}>Overdue</th>
              <th style={{ width: 70 }}>Errors</th>
              <th style={{ width: 120 }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("due")}
                >
                  Due
                </button>
              </th>
              <th style={{ width: 140 }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("modified")}
                >
                  Last modified
                </button>
              </th>
              <th style={{ width: 140 }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("status")}
                >
                  Status
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const p = row.project;
              const checked = selectedIds.has(p.id);
              return (
                <tr
                  key={p.id}
                  className={`fc-table-row${checked ? " selected" : ""}`}
                  onClick={() => onToggleSelected(p.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleSelected(p.id);
                    }
                  }}
                  tabIndex={0}
                  aria-selected={checked}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelected(p.id)}
                      aria-label={`Select project ${p.name}`}
                    />
                  </td>
                  <td>
                    <div className="fw-semibold">{p.name}</div>
                    <div className="text-muted small">
                      #{p.id} - {row.ownerLabel}
                    </div>
                  </td>
                  <td>
                    <LanguagePair srcLang={p.srcLang} tgtLang={p.tgtLang} targetLangs={p.targetLangs} />
                  </td>
                  <td>
                    <ProgressBar percent={row.progressPct} />
                    {row.isProvisioning ? (
                      <div className="text-muted small mt-1">
                        {formatProvisioningStep(row.provisioningStep)}
                        {row.provisioningUpdatedAt ? ` • Last update: ${formatDateTimeShort(row.provisioningUpdatedAt)}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {row.overdueDays != null && row.overdueDays > 0 ? (
                      <BadgePill tone="overdue">+{row.overdueDays}d</BadgePill>
                    ) : (
                      <span className="text-muted small">-</span>
                    )}
                  </td>
                  <td>
                    {row.errorCount > 0 ? (
                      <BadgePill tone="danger">{row.errorCount}</BadgePill>
                    ) : (
                      <span className="text-muted small">0</span>
                    )}
                  </td>
                  <td>{formatDateTimeShort(row.dueAt)}</td>
                  <td>{formatDateTimeShort(row.lastModifiedAt)}</td>
                  <td>
                    <StatusPill label={row.statusLabel} tone={row.statusTone} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
