import React from "react";

export type FieldSchema = {
  name: string;
  level: "entry" | "language" | "term";
  type?: string;
  picklistValues?: string[];
  multiline?: boolean;
};

type FieldRendererProps = {
  field: FieldSchema;
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  dense?: boolean;
};

function normalizeFieldType(field: FieldSchema): "text" | "textarea" | "picklist" {
  const rawType = String(field.type ?? "text").trim().toLowerCase();
  if (rawType === "picklist") return "picklist";
  if (rawType === "textarea") return "textarea";
  if (rawType === "text") return "text";
  console.warn(`[termbase] Unknown field type "${field.type}" for "${field.name}". Rendering as text.`);
  return "text";
}

function normalizeFieldLabel(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeFieldKey(value: string) {
  return normalizeFieldLabel(value).replace(/[^a-z0-9]/g, "");
}

function isExplanationField(name: string) {
  const key = normalizeFieldKey(name);
  return key === "erlauterung" || key === "erlaeuterung";
}

export function FieldRenderer(props: FieldRendererProps) {
  const { field, onChange, disabled, dense } = props;
  const value = props.value == null ? "" : String(props.value);
  const normalizedType = normalizeFieldType(field);
  const forceTextarea = field.multiline || isExplanationField(field.name);
  const useTextarea = normalizedType === "textarea" || forceTextarea;
  const inputClass = `form-control${dense ? " form-control-sm" : ""}`;
  const selectClass = `form-select${dense ? " form-select-sm" : ""}`;

  return (
    <div className={`fc-termbase-field-row${dense ? " is-compact" : ""}`}>
      <label className="form-label small text-muted fc-termbase-field-label">{field.name}</label>
      <div className="fc-termbase-field-control">
        {normalizedType === "picklist" ? (
          <select
            className={selectClass}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
          >
            <option value="">Select...</option>
            {value && !(field.picklistValues ?? []).includes(value) && (
              <option value={value}>{value}</option>
            )}
            {(field.picklistValues ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : useTextarea ? (
          <textarea
            className={inputClass}
            rows={dense ? 2 : 3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
          />
        ) : (
          <input
            className={inputClass}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

export function DynamicFieldsSection(props: {
  fields: FieldSchema[];
  values?: Record<string, any> | null;
  onChange: (fieldName: string, value: string) => void;
  disabled?: boolean;
  dense?: boolean;
}) {
  const { fields, values, onChange, disabled, dense } = props;
  if (!fields || fields.length === 0) return null;
  const normalizedValues = new Map<string, any>();
  if (values) {
    Object.entries(values).forEach(([key, value]) => {
      const normalized = normalizeFieldKey(key);
      if (!normalized || normalizedValues.has(normalized)) return;
      normalizedValues.set(normalized, value);
    });
  }
  const resolveValue = (fieldName: string) => {
    if (values && Object.prototype.hasOwnProperty.call(values, fieldName)) {
      return values[fieldName];
    }
    const normalized = normalizeFieldKey(fieldName);
    if (normalized && normalizedValues.has(normalized)) {
      return normalizedValues.get(normalized);
    }
    return "";
  };
  return (
    <div className={`fc-termbase-fields${dense ? " is-compact" : ""}`}>
      {fields.map((field) => (
        <FieldRenderer
          key={`${field.level}-${field.name}`}
          field={field}
          value={resolveValue(field.name)}
          onChange={(value) => onChange(field.name, value)}
          disabled={disabled}
          dense={dense}
        />
      ))}
    </div>
  );
}
