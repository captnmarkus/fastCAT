import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAppAgentStatus, listInboxItems, listProjects } from "../api";
import ChatPanel from "../components/dashboard/ChatPanel";
import type { AuthUser } from "../types/app";
import type { AppAgentStatusResponse } from "../api";

type DashboardSummary = {
  activeProjects: number;
  actionRequired: number;
  readyToDownload: number;
  averageProgress: number;
};

const DONE_STATUSES = new Set(["reviewed", "approved", "done", "completed", "ready_for_download"]);

function normalizeStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default function DashboardPage({ currentUser }: { currentUser: AuthUser | null }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary>({
    activeProjects: 0,
    actionRequired: 0,
    readyToDownload: 0,
    averageProgress: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AppAgentStatusResponse | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projects, inboxItems, nextAgentStatus] = await Promise.all([
        listProjects(),
        listInboxItems(),
        getAppAgentStatus()
      ]);

      const activeProjects = projects.filter((project) => !DONE_STATUSES.has(normalizeStatus(project.status))).length;
      const readyToDownload = projects.filter((project) => DONE_STATUSES.has(normalizeStatus(project.status))).length;
      const actionRequired = inboxItems.filter((item) => !DONE_STATUSES.has(normalizeStatus(item.status))).length;

      const progressValues = inboxItems
        .map((item) => Number(item.progressPct || 0))
        .filter((value) => Number.isFinite(value));
      const averageProgress =
        progressValues.length > 0
          ? Math.max(0, Math.min(100, Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length)))
          : 0;

      setSummary({
        activeProjects,
        actionRequired,
        readyToDownload,
        averageProgress
      });
      setAgentStatus(nextAgentStatus);
    } catch (err: any) {
      setError(err?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    void loadSummary();
  }, [currentUser, loadSummary]);

  if (!currentUser || loading) {
    return <div className="text-muted p-3">Loading dashboard...</div>;
  }

  return (
    <div className="fc-dashboard-page py-3">
      <section className="card-enterprise fc-dashboard-hero" aria-labelledby="fc-dashboard-title">
        <div className="fc-dashboard-hero-content">
          <div className="fc-dashboard-hero-main">
            <div className="fc-dashboard-kicker">Home</div>
            <h1 id="fc-dashboard-title" className="fc-dashboard-title">
              Translate faster with fewer clicks
            </h1>
            <p className="fc-dashboard-subtitle">
              Start a translation, track progress, download deliverables, and resolve action-required items from one place.
            </p>
            <div className="fc-dashboard-hero-actions">
              <button type="button" className="btn btn-dark" onClick={() => navigate("/projects/create")}>
                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                Start New Translation
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => navigate("/projects")}>
                Open Projects
              </button>
            </div>
            <div className="fc-dashboard-hero-note">Smart defaults first. Advanced project options stay in the full wizard.</div>
          </div>

          <div className="fc-dashboard-metrics" aria-label="Dashboard summary">
            <div className="fc-dashboard-metric">
              <div className="fc-dashboard-metric-label">Active projects</div>
              <div className="fc-dashboard-metric-value">{summary.activeProjects}</div>
            </div>
            <div className="fc-dashboard-metric">
              <div className="fc-dashboard-metric-label">Action required</div>
              <div className="fc-dashboard-metric-value">{summary.actionRequired}</div>
            </div>
            <div className="fc-dashboard-metric">
              <div className="fc-dashboard-metric-label">Ready to download</div>
              <div className="fc-dashboard-metric-value">{summary.readyToDownload}</div>
            </div>
            <div className="fc-dashboard-metric">
              <div className="fc-dashboard-metric-label">Average progress</div>
              <div className="fc-dashboard-metric-value">{summary.averageProgress}%</div>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="alert alert-danger d-flex align-items-center justify-content-between mb-0" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => loadSummary()}>
            Retry
          </button>
        </div>
      ) : null}
      {agentStatus && !agentStatus.availability.usable ? (
        <section className="card-enterprise fc-dashboard-agent-placeholder">
          <div className="fc-dashboard-agent-placeholder-kicker">App Agent</div>
          <div className="fc-dashboard-agent-placeholder-title">{agentStatus.availability.title}</div>
          <p className="fc-dashboard-agent-placeholder-copy mb-0">{agentStatus.availability.description}</p>
          <div className="fc-dashboard-agent-placeholder-meta">
            {currentUser.role === "admin"
              ? "Open the admin panel to complete the live agent setup."
              : "An administrator needs to finish the App Agent setup before chat becomes available here."}
          </div>
          {currentUser.role === "admin" ? (
            <div className="fc-dashboard-agent-placeholder-actions">
              <button type="button" className="btn btn-dark" onClick={() => navigate("/admin/app-agent")}>
                Open App Agent Settings
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <ChatPanel />
      )}
    </div>
  );
}
