import React from "react";

export default function ProgressBar({ percent }: { percent: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return (
    <div className="d-flex align-items-center gap-2">
      <div className="progress flex-grow-1" style={{ height: 6 }}>
        <div
          className="progress-bar bg-dark"
          role="progressbar"
          style={{ width: `${pct}%` }}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="small text-muted" style={{ width: 44, textAlign: "right" }}>
        {pct}%
      </div>
    </div>
  );
}

