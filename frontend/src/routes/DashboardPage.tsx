import React, { useCallback, useEffect, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SettingsSuggestIcon from "@mui/icons-material/SettingsSuggest";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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
    return (
      <Box sx={{ color: "text.secondary", p: 3 }}>
        Loading dashboard...
      </Box>
    );
  }

  return (
    <Box className="fc-dashboard-page" sx={{ py: 3 }}>
      <Box component="section" className="fc-dashboard-hero" aria-labelledby="fc-dashboard-title">
        <img
          className="fc-dashboard-hero-image"
          src="/images/fastcat-dashboard-hero.png"
          alt=""
          aria-hidden="true"
        />
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
              <Button
                type="button"
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => navigate("/projects/create")}
              >
                Start New Translation
              </Button>
              <Button
                type="button"
                variant="outlined"
                startIcon={<FolderOpenIcon />}
                onClick={() => navigate("/projects")}
                sx={{
                  borderColor: "rgba(255, 255, 255, 0.56)",
                  color: "#f8fafc",
                  backgroundColor: "rgba(15, 23, 42, 0.14)",
                  "&:hover": {
                    borderColor: "rgba(255, 255, 255, 0.76)",
                    backgroundColor: "rgba(15, 23, 42, 0.26)"
                  }
                }}
              >
                Open Projects
              </Button>
            </div>
            <div className="fc-dashboard-hero-note">Smart defaults first. Advanced project options stay in the full wizard.</div>
          </div>

          <Box className="fc-dashboard-metrics" aria-label="Dashboard summary">
            <Paper className="fc-dashboard-metric" elevation={0}>
              <div className="fc-dashboard-metric-label">Active projects</div>
              <div className="fc-dashboard-metric-value">{summary.activeProjects}</div>
            </Paper>
            <Paper className="fc-dashboard-metric" elevation={0}>
              <div className="fc-dashboard-metric-label">Action required</div>
              <div className="fc-dashboard-metric-value">{summary.actionRequired}</div>
            </Paper>
            <Paper className="fc-dashboard-metric" elevation={0}>
              <div className="fc-dashboard-metric-label">Ready to download</div>
              <div className="fc-dashboard-metric-value">{summary.readyToDownload}</div>
            </Paper>
            <Paper className="fc-dashboard-metric" elevation={0}>
              <div className="fc-dashboard-metric-label">Average progress</div>
              <div className="fc-dashboard-metric-value">{summary.averageProgress}%</div>
            </Paper>
          </Box>
        </div>
      </Box>

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => loadSummary()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}
      {agentStatus && !agentStatus.availability.usable ? (
        <Paper component="section" className="fc-dashboard-agent-placeholder" elevation={0}>
          <div className="fc-dashboard-agent-placeholder-content">
            <div className="fc-dashboard-agent-placeholder-kicker">App Agent</div>
            <Typography className="fc-dashboard-agent-placeholder-title" component="h2">
              {agentStatus.availability.title}
            </Typography>
            <Typography className="fc-dashboard-agent-placeholder-copy" variant="body2">
              {agentStatus.availability.description}
            </Typography>
            <div className="fc-dashboard-agent-placeholder-meta">
              {currentUser.role === "admin"
                ? "Open the admin panel to complete the live agent setup."
                : "An administrator needs to finish the App Agent setup before chat becomes available here."}
            </div>
            {currentUser.role === "admin" ? (
              <Stack className="fc-dashboard-agent-placeholder-actions" direction="row">
                <Button
                  type="button"
                  variant="contained"
                  color="primary"
                  startIcon={<SettingsSuggestIcon />}
                  onClick={() => navigate("/admin/app-agent")}
                >
                  Open App Agent Settings
                </Button>
              </Stack>
            ) : null}
          </div>
          <div className="fc-dashboard-agent-visual" aria-hidden="true">
            <img src="/images/fastcat-agent-visual.png" alt="" />
          </div>
        </Paper>
      ) : (
        <ChatPanel />
      )}
    </Box>
  );
}
