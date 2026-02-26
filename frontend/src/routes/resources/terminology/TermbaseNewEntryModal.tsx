import React, { useEffect, useState } from "react";
import Modal from "../../../components/Modal";
import { resolveAvailableLanguage } from "./TermbaseEditor.helpers";

export type TermbaseNewEntryPayload = {
  sourceLang: string;
  targetLang: string;
  sourceTerm: string;
  targetTerm: string;
};

export default function TermbaseNewEntryModal(props: {
  open: boolean;
  languages: string[];
  defaultSourceLang?: string | null;
  defaultTargetLang?: string | null;
  onClose: () => void;
  onCreate: (payload: TermbaseNewEntryPayload) => Promise<void>;
}) {
  const [sourceLang, setSourceLang] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [sourceTerm, setSourceTerm] = useState("");
  const [targetTerm, setTargetTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const preferredSource = resolveAvailableLanguage(props.defaultSourceLang || "", props.languages);
    const effectiveSource = preferredSource || props.languages[0] || "";
    const preferredTarget = resolveAvailableLanguage(props.defaultTargetLang || "", props.languages);
    const effectiveTarget =
      preferredTarget && preferredTarget !== effectiveSource
        ? preferredTarget
        : props.languages.find((lang) => lang !== effectiveSource) || effectiveSource;
    setSourceLang(effectiveSource);
    setTargetLang(effectiveTarget);
    setSourceTerm("");
    setTargetTerm("");
    setError(null);
    setSaving(false);
  }, [props.defaultSourceLang, props.defaultTargetLang, props.languages, props.open]);

  async function handleCreate() {
    const srcLang = sourceLang.trim();
    const tgtLang = targetLang.trim();
    const srcTerm = sourceTerm.trim();
    const tgtTerm = targetTerm.trim();
    if (!srcLang || !srcTerm || !tgtLang || !tgtTerm) {
      setError("Enter languages and terms for the new entry.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await props.onCreate({ sourceLang: srcLang, targetLang: tgtLang, sourceTerm: srcTerm, targetTerm: tgtTerm });
      props.onClose();
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to create entry.");
    } finally {
      setSaving(false);
    }
  }

  if (!props.open) return null;

  return (
    <Modal
      title="New entry"
      onClose={props.onClose}
      closeDisabled={saving}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={props.onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create entry"}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label">Language A</label>
          <input
            className="form-control"
            list="termbase-language-options"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">Language B</label>
          <input
            className="form-control"
            list="termbase-language-options"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">Term (A)</label>
          <input
            className="form-control"
            value={sourceTerm}
            onChange={(e) => setSourceTerm(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label">Term (B)</label>
          <input
            className="form-control"
            value={targetTerm}
            onChange={(e) => setTargetTerm(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>
    </Modal>
  );
}
