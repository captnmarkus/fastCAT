import React from "react";
import { useOutletContext } from "react-router-dom";
import type { TermbaseField } from "../../../api";
import type { TermbaseShellContext } from "./TermbaseShellPage";

function renderFields(title: string, fields: TermbaseField[] | undefined) {
  return (
    <div className="card-enterprise p-3">
      <div className="fw-semibold mb-2">{title}</div>
      {fields && fields.length > 0 ? (
        <div className="d-grid gap-2">
          {fields.map((field, idx) => (
            <div key={`${field.name}-${idx}`} className="border rounded p-2 bg-white">
              <div className="fw-semibold small">{field.name}</div>
              <div className="text-muted small">
                {field.type === "picklist" ? "Picklist" : "Text"}
                {field.type === "picklist" && field.values && field.values.length > 0 && (
                  <span> · {field.values.join(", ")}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted small">No fields defined.</div>
      )}
    </div>
  );
}

export default function TermbaseStructurePage() {
  const { meta } = useOutletContext<TermbaseShellContext>();
  const structure = meta?.structure;

  return (
    <div className="p-3 d-grid gap-3">
      <div className="fw-semibold">Structure</div>
      <div className="text-muted small">
        Structure is defined when the termbase is created. Editing will be added later.
      </div>
      {renderFields("Entry fields", structure?.entry)}
      {renderFields("Language fields", structure?.language)}
      {renderFields("Term fields", structure?.term)}
    </div>
  );
}
