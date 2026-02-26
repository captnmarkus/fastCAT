import React, { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { getTermbase, type TermbaseMeta } from "../../../api";
import type { AuthUser } from "../../../types/app";

export type TermbaseEntryActions = {
  onNewEntry: () => void;
  onDeleteEntry: () => void;
  canCreate: boolean;
  canDelete: boolean;
  deleting: boolean;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error";
  saveError: string | null;
};

export type TermbaseShellContext = {
  termbaseId: number;
  meta: TermbaseMeta | null;
  setMeta: React.Dispatch<React.SetStateAction<TermbaseMeta | null>>;
  refreshMeta: () => Promise<void>;
  canEdit: boolean;
  registerEntryActions: (actions: TermbaseEntryActions | null) => void;
};

function entryCountLabel(total: number) {
  return total === 1 ? "1 entry" : `${total} entries`;
}

function actionButtonClass(active: boolean) {
  return `btn btn-outline-secondary btn-sm${active ? " active" : ""}`;
}

export default function TermbaseShellPage({ currentUser }: { currentUser: AuthUser }) {
  const params = useParams<{ termbaseId: string }>();
  const termbaseId = Number(params.termbaseId);
  const canEdit = currentUser.role === "admin" || currentUser.role === "manager";

  const [meta, setMeta] = useState<TermbaseMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entryActions, setEntryActions] = useState<TermbaseEntryActions | null>(null);

  const refreshMeta = useCallback(async () => {
    if (!Number.isFinite(termbaseId) || termbaseId <= 0) return;
    setError(null);
    setLoading(true);
    try {
      const data = await getTermbase(termbaseId);
      setMeta(data);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load termbase.");
    } finally {
      setLoading(false);
    }
  }, [termbaseId]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const registerEntryActions = useCallback((actions: TermbaseEntryActions | null) => {
    setEntryActions(actions);
  }, []);

  const contextValue = useMemo<TermbaseShellContext>(
    () => ({
      termbaseId,
      meta,
      setMeta,
      refreshMeta,
      canEdit,
      registerEntryActions
    }),
    [canEdit, meta, refreshMeta, registerEntryActions, termbaseId]
  );

  if (!Number.isFinite(termbaseId) || termbaseId <= 0) {
    return <div className="alert alert-warning">Invalid termbase link.</div>;
  }

  const entryCount = meta?.entryCount ?? 0;
  const name = meta?.name || `Termbase ${termbaseId}`;

  return (
    <div className="fc-termbase-editor card-enterprise">
      <div className="fc-termbase-header">
        <div className="fc-termbase-title">
          <NavLink to="/resources/terminology" className="btn btn-link btn-sm p-0">
            Terminology
          </NavLink>
          <span className="text-muted mx-2">/</span>
          <NavLink to={`/resources/termbases/${termbaseId}/entries`} className="fw-semibold text-decoration-none">
            {name}
          </NavLink>
          <span className="text-muted ms-2">{entryCountLabel(entryCount)}</span>
        </div>

        <div className="fc-termbase-actions">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={entryActions?.onNewEntry}
            disabled={!entryActions?.canCreate}
          >
            New entry
          </button>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={entryActions?.onDeleteEntry}
            disabled={!entryActions?.canDelete}
          >
            {entryActions?.deleting ? "Deleting..." : "Delete entry"}
          </button>
          {canEdit ? (
            <NavLink
              to={`/resources/termbases/${termbaseId}/import`}
              className={({ isActive }) => actionButtonClass(isActive)}
            >
              Import
            </NavLink>
          ) : (
            <span className="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">
              Import
            </span>
          )}
          {canEdit ? (
            <NavLink
              to={`/resources/termbases/${termbaseId}/export`}
              className={({ isActive }) => actionButtonClass(isActive)}
            >
              Export
            </NavLink>
          ) : (
            <span className="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">
              Export
            </span>
          )}
          {canEdit ? (
            <NavLink
              to={`/resources/termbases/${termbaseId}/structure`}
              className={({ isActive }) => actionButtonClass(isActive)}
            >
              Structure
            </NavLink>
          ) : (
            <span className="btn btn-outline-secondary btn-sm disabled" aria-disabled="true">
              Structure
            </span>
          )}
        </div>

        <div className="fc-termbase-toolbar">
          <div className="fc-termbase-save">
            {entryActions?.saveState === "saving" && <span className="text-muted small">Saving...</span>}
            {entryActions?.saveState === "saved" && <span className="text-success small">Saved</span>}
            {entryActions?.saveState === "dirty" && <span className="text-muted small">Unsaved changes</span>}
            {entryActions?.saveState === "error" && <span className="text-danger small">Save failed</span>}
            {entryActions?.saveState === "error" && entryActions?.saveError && (
              <div className="text-danger small">{entryActions.saveError}</div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger m-3 mb-0">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted p-3">Loading termbase...</div>
      ) : (
        <Outlet context={contextValue} />
      )}
    </div>
  );
}
