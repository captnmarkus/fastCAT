import React from "react";
import { formatDateTimeShort, formatRelativeTime } from "../../../projects/shared/dates";
import LanguagePair from "../../../projects/shared/components/LanguagePair";
import ProgressBar from "../../../projects/shared/components/ProgressBar";
import StatusPill from "../../../projects/shared/components/StatusPill";
import type { InboxRow, SortDir, SortKey } from "../types";
import { labelForInboxStatus, toneForInboxStatus } from "../../shared/status";

type Props = {
  rows: InboxRow[];
  selectedIds: Set<number>;
  selectAllRef: React.RefObject<HTMLInputElement>;
  onToggleSelected: (taskId: number) => void;
  onToggleSelectAllVisible: () => void;
  onSetSort: (key: SortKey) => void;
  sortKey: SortKey;
  sortDir: SortDir;
};

export default function InboxTable({
  rows,
  selectedIds,
  selectAllRef,
  onToggleSelected,
  onToggleSelectAllVisible,
  onSetSort,
  sortKey,
  sortDir
}: Props) {
  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return null;
    return <span className="text-muted ms-1">{sortDir === "asc" ? "^" : "v"}</span>;
  };

  const formatCount = (value: number) => {
    const count = Number(value);
    if (!Number.isFinite(count)) return "0";
    return count.toLocaleString();
  };

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
                  aria-label="Select all inbox tasks"
                />
              </th>
              <th>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("file")}
                >
                  File {sortIndicator("file")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("project")}
                >
                  Project {sortIndicator("project")}
                </button>
              </th>
              <th style={{ width: 160 }}>Languages</th>
              <th style={{ width: 190 }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("progress")}
                >
                  Progress {sortIndicator("progress")}
                </button>
              </th>
              <th style={{ width: 140 }}>Status</th>
              <th style={{ width: 170 }}>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 text-decoration-none fc-table-sort"
                  onClick={() => onSetSort("modified")}
                >
                  Last modified {sortIndicator("modified")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checked = selectedIds.has(row.taskId);
              const total = Number(row.segmentStats?.total ?? 0) || 0;
              const reviewed = Number(row.segmentStats?.reviewed ?? 0) || 0;
              const pct = total > 0 ? Math.round((reviewed / total) * 100) : row.progressPct ?? 0;
              const wordCount = Number(row.sourceWordCount ?? 0) || 0;
              const segmentCount = Number(row.segmentCount ?? total ?? 0) || 0;
              const updatedAt = row.modifiedAt || row.createdAt;
              const metaParts = [
                `${formatCount(wordCount)} words`,
                `${formatCount(segmentCount)} segments`,
                `${formatCount(reviewed)}/${formatCount(segmentCount)} reviewed`,
                `Updated ${formatRelativeTime(updatedAt)}`
              ];
              return (
                <tr
                  key={row.taskId}
                  className={`fc-table-row${checked ? " selected" : ""}`}
                  onClick={() => onToggleSelected(row.taskId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onToggleSelected(row.taskId);
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
                      onChange={() => onToggleSelected(row.taskId)}
                      aria-label={`Select ${row.originalFilename}`}
                    />
                  </td>
                  <td>
                    <div className="fw-semibold">{row.originalFilename}</div>
                    <div className="text-muted small">{metaParts.join(" | ")}</div>
                  </td>
                  <td>
                    <div className="fw-semibold">{row.projectName}</div>
                    <div className="text-muted small">#{row.projectId}</div>
                  </td>
                  <td>
                    <LanguagePair srcLang={row.srcLang} tgtLang={row.tgtLang} />
                  </td>
                  <td>
                    <ProgressBar percent={pct} />
                  </td>
                  <td>
                    <StatusPill label={labelForInboxStatus(row.status)} tone={toneForInboxStatus(row.status)} />
                  </td>
                  <td className="text-muted small">
                    {formatDateTimeShort(row.modifiedAt || row.createdAt)}
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

