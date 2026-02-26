import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../../../types/app";
import { checkTmLibraryName, uploadTmLibraryTmx } from "../../../api";
import { formatBytes } from "../../../utils/format";
import WizardShell from "../../../components/ui/WizardShell";
import WarningBanner from "../../../components/ui/WarningBanner";

type WizardStepKey = "basics" | "upload" | "review";

const STEP_ORDER: Array<{ key: WizardStepKey; label: string }> = [
  { key: "basics", label: "Basics" },
  { key: "upload", label: "Upload TMX" },
  { key: "review", label: "Review & Create" }
];

function isValidTmxFile(file: File | null) {
  if (!file) return false;
  return file.name.toLowerCase().endsWith(".tmx");
}

type NameCheckStatus = "idle" | "checking" | "available" | "duplicate" | "error";

export default function TranslationMemoryWizardPage({ currentUser }: { currentUser: AuthUser }) {
  const nav = useNavigate();

  const [step, setStep] = useState<WizardStepKey>("basics");
  const [showValidation, setShowValidation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameCheckStatus>("idle");
  const nameCheckSeq = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const nameError = useMemo(() => {
    if (!name.trim()) return "Name is required.";
    if (nameStatus === "duplicate") return "A translation memory with this name already exists.";
    if (nameStatus === "error") return "Could not verify name availability.";
    return null;
  }, [name, nameStatus]);

  const fileError = useMemo(() => {
    if (!file) return "TMX file is required.";
    if (!isValidTmxFile(file)) return "Only .tmx files are supported.";
    return null;
  }, [file]);

  const canProceed = useMemo(() => {
    if (step === "basics") return Boolean(name.trim()) && nameStatus !== "duplicate" && nameStatus !== "checking" && nameStatus !== "error";
    if (step === "upload") return Boolean(file) && isValidTmxFile(file);
    return false;
  }, [file, name, nameStatus, step]);

  async function runNameCheck(value: string) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      setNameStatus("idle");
      return "empty";
    }
    const seq = ++nameCheckSeq.current;
    setNameStatus("checking");
    try {
      const exists = await checkTmLibraryName(trimmed);
      if (seq !== nameCheckSeq.current) return null;
      setNameStatus(exists ? "duplicate" : "available");
      return exists ? "duplicate" : "available";
    } catch {
      if (seq !== nameCheckSeq.current) return null;
      setNameStatus("error");
      return "error";
    }
  }

  function goToStep(next: WizardStepKey) {
    setStep(next);
  }

  async function goNext() {
    if (step === "review") return;
    setShowValidation(true);
    if (step === "basics") {
      if (!name.trim()) return;
      const status = await runNameCheck(name);
      if (status === "duplicate" || status === "error") return;
      return goToStep("upload");
    }
    if (step === "upload") {
      if (fileError) return;
      return goToStep("review");
    }
  }

  function goBack() {
    if (step === "basics") return;
    if (step === "upload") return goToStep("basics");
    return goToStep("upload");
  }

  async function handleCreate() {
    setShowValidation(true);
    setError(null);

    if (!name.trim()) {
      goToStep("basics");
      return;
    }
    const status = await runNameCheck(name);
    if (status === "duplicate" || status === "error") {
      goToStep("basics");
      return;
    }
    if (fileError) {
      goToStep("upload");
      return;
    }

    setSaving(true);
    try {
      const res = await uploadTmLibraryTmx({
        file: file as File,
        label: name.trim(),
        comment: comment.trim() || undefined
      });
      const newId = res.entry?.id;
      if (newId) {
        nav(`/resources/translation-memories/${newId}`, { replace: true });
      } else {
        nav("/resources/translation-memories");
      }
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to create translation memory.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <WizardShell
        eyebrow="Resources / Translation Memories"
        title="New Translation Memory"
        onCancel={() => nav("/resources/translation-memories")}
        cancelDisabled={saving}
        topActions={
          step === "review" ? (
            <button type="button" className="btn btn-primary fw-semibold" onClick={handleCreate} disabled={saving}>
              {saving ? "Creating..." : "Create"}
            </button>
          ) : null
        }
        steps={STEP_ORDER}
        currentStep={step}
        onStepSelect={goToStep}
        canSelectStep={(_key, index, currentIndex) => index < currentIndex && !saving}
        alerts={error ? <WarningBanner tone="error" messages={[error]} /> : null}
        footer={
          <div className="d-flex justify-content-between align-items-center">
            <button type="button" className="btn btn-outline-secondary" onClick={goBack} disabled={saving || step === "basics"}>
              Back
            </button>
            <button type="button" className="btn btn-dark" onClick={goNext} disabled={saving || step === "review" || !canProceed}>
              Next
            </button>
          </div>
        }
      >
        {step === "basics" && (
          <div className="row g-3">
            <div className="col-lg-7">
              <label className="form-label">Name</label>
              <input
                className={`form-control ${((showValidation || nameTouched) && nameError) ? "is-invalid" : ""}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  setNameTouched(true);
                  if (name.trim()) runNameCheck(name);
                }}
                disabled={saving}
                placeholder="Customer TMX"
              />
              {((showValidation || nameTouched) && nameError) ? <div className="invalid-feedback">{nameError}</div> : null}
              {nameStatus === "checking" ? <div className="form-text text-muted">Checking name availability...</div> : null}
            </div>
            <div className="col-lg-5">
              <label className="form-label">Created by</label>
              <div className="form-control-plaintext">{currentUser.displayName || currentUser.username}</div>
            </div>
            <div className="col-12">
              <label className="form-label">Comment / Description (optional)</label>
              <textarea
                className="form-control"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={saving}
                placeholder="What is this TMX used for?"
              />
            </div>
          </div>
        )}

        {step === "upload" && (
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label">TMX file</label>
              {file ? (
                <div className="border rounded p-3 bg-white">
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <div>
                      <div className="fw-semibold">{file.name}</div>
                      <div className="text-muted small">{formatBytes(file.size)}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => {
                        setFile(null);
                        setFileKey((k) => k + 1);
                      }}
                      disabled={saving}
                    >
                      Replace file
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    key={fileKey}
                    type="file"
                    className={`form-control ${showValidation && fileError ? "is-invalid" : ""}`}
                    accept=".tmx,application/xml,text/xml"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    disabled={saving}
                  />
                  {showValidation && fileError ? <div className="invalid-feedback">{fileError}</div> : null}
                </>
              )}
            </div>
            <div className="col-12">
              <div className="text-muted small">
                Only TMX files are supported. You can replace the selected file before creating the TM.
              </div>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="row g-3">
            <div className="col-md-6">
              <div className="text-muted small">Name</div>
              <div className="fw-semibold">{name.trim() || "-"}</div>
            </div>
            <div className="col-md-6">
              <div className="text-muted small">File</div>
              <div className="fw-semibold">{file ? file.name : "-"}</div>
              <div className="text-muted small">{file ? formatBytes(file.size) : "-"}</div>
            </div>
            <div className="col-12">
              <div className="text-muted small">Comment / Description</div>
              <div className="fw-semibold">{comment.trim() || "-"}</div>
            </div>
            <div className="col-12">
              <div className="text-muted small">Created by</div>
              <div className="fw-semibold">{currentUser.displayName || currentUser.username}</div>
            </div>
          </div>
        )}
      </WizardShell>
    </div>
  );
}
