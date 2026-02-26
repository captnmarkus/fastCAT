import React from "react";

type TableToolbarProps = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
};

export default function TableToolbar({
  left = null,
  right = null,
  className = ""
}: TableToolbarProps) {
  const wrapperClass = className ? `fc-table-toolbar ${className}` : "fc-table-toolbar";

  return (
    <div className={wrapperClass}>
      <div className="fc-table-toolbar-left">{left}</div>
      <div className="fc-table-toolbar-right">{right}</div>
    </div>
  );
}
