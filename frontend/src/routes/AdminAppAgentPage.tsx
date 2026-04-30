import React, { useEffect, useMemo, useState } from "react";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import KeyIcon from "@mui/icons-material/Key";
import SaveIcon from "@mui/icons-material/Save";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import Alert, { type AlertColor } from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  getAppAgentAdminConfig,
  updateAppAgentAdminConfig,
  type AppAgentAvailability,
  type AppAgentAdminConfig,
  type AppAgentToolName
} from "../api";
import type { AuthUser } from "../types/app";

const TOOL_LABELS: Record<AppAgentToolName, string> = {
  translate_snippet: "Translate Snippet",
  create_project: "Create Project",
  list_projects: "List Projects",
  get_project_status: "Get Project Status"
};

const TOOL_DESCRIPTIONS: Record<AppAgentToolName, string> = {
  translate_snippet: "Translate small snippets with max-length enforcement.",
  create_project: "Create a project for the current user from uploaded files.",
  list_projects: "List projects for the current user.",
  get_project_status: "Read project progress for the current user."
};

function availabilitySeverity(availability: AppAgentAvailability | null): AlertColor {
  if (!availability) return "info";
  if (availability.state === "ready_live") return "success";
  if (availability.state === "ready_mock") return "info";
  if (availability.state === "disabled") return "info";
  return "warning";
}

export default function AdminAppAgentPage({ currentUser }: { currentUser: AuthUser }) {
  const [config, setConfig] = useState<AppAgentAdminConfig | null>(null);
  const [availability, setAvailability] = useState<AppAgentAvailability | null>(null);
  const [providerOptions, setProviderOptions] = useState<Array<{ id: number; name: string; model: string; enabled: boolean }>>([]);
  const [allowlistedTools, setAllowlistedTools] = useState<AppAgentToolName[]>([]);
  const [replaceProviderKey, setReplaceProviderKey] = useState(false);
  const [clearProviderKey, setClearProviderKey] = useState(false);
  const [providerKeyInput, setProviderKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getAppAgentAdminConfig();
        if (cancelled) return;
        setConfig(res.config);
        setAvailability(res.availability);
        setProviderOptions(res.providers || []);
        setAllowlistedTools(res.allowlistedTools || []);
        setReplaceProviderKey(false);
        setClearProviderKey(false);
        setProviderKeyInput("");
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.userMessage || err?.message || "Failed to load App Agent config.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleTools = useMemo(() => {
    if (allowlistedTools.length > 0) return allowlistedTools;
    return Object.keys(TOOL_LABELS) as AppAgentToolName[];
  }, [allowlistedTools]);

  async function handleSave() {
    if (!config || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Partial<AppAgentAdminConfig> = {
        enabled: config.enabled,
        connectionProvider: config.connectionProvider,
        providerId: config.providerId,
        modelName: config.modelName,
        endpoint: config.endpoint,
        mockMode: config.mockMode,
        systemPrompt: config.systemPrompt,
        enabledTools: config.enabledTools,
        providerOrg: config.providerOrg || null,
        providerProject: config.providerProject || null,
        providerRegion: config.providerRegion || null
      };
      if (clearProviderKey) {
        payload.clearProviderApiKey = true;
        payload.providerApiKey = null;
      } else if (replaceProviderKey && providerKeyInput.trim()) {
        payload.providerApiKey = providerKeyInput.trim();
      }
      const res = await updateAppAgentAdminConfig(payload);
      setConfig(res.config);
      setAvailability(res.availability);
      setReplaceProviderKey(false);
      setClearProviderKey(false);
      setProviderKeyInput("");
      setSuccess("App Agent configuration updated.");
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to update App Agent config.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !config) {
    return (
      <Box sx={{ py: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CircularProgress size={20} />
          <Typography color="text.secondary">Loading App Agent settings...</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 3 }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between">
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: 2,
                display: "grid",
                placeItems: "center",
                color: "primary.contrastText",
                bgcolor: "primary.main"
              }}
            >
              <SmartToyIcon fontSize="small" />
            </Box>
            <Box>
              <Typography variant="h4" component="h1" sx={{ fontSize: "1.55rem" }}>
                App Agent
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Configure the assistant, provider, and project tools.
              </Typography>
            </Box>
          </Stack>
          <Chip
            icon={availability?.usable ? <CheckCircleIcon /> : undefined}
            label={availability?.providerLabel || (availability?.mock ? "Mock mode" : "Needs setup")}
            color={availability?.usable ? "success" : "warning"}
            variant="outlined"
          />
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {success ? <Alert severity="success">{success}</Alert> : null}
        {availability ? (
          <Alert severity={availabilitySeverity(availability)}>
            <Typography variant="subtitle2" component="div">
              {availability.title}
            </Typography>
            <Typography variant="body2">{availability.description}</Typography>
          </Alert>
        ) : null}

        <Card elevation={0}>
          <CardContent sx={{ p: { xs: 2, md: 3 }, "&:last-child": { pb: { xs: 2, md: 3 } } }}>
            <Stack spacing={3}>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.enabled}
                    onChange={(event) => setConfig((prev) => (prev ? { ...prev, enabled: event.target.checked } : prev))}
                  />
                }
                label={
                  <Box>
                    <Typography variant="subtitle2">Enable App Agent</Typography>
                    <Typography variant="body2" color="text.secondary">
                      When disabled, the dashboard shows a setup placeholder instead of chat.
                    </Typography>
                  </Box>
                }
              />

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0, 1fr))" },
                  gap: 2
                }}
              >
                <TextField
                  select
                  label="Connection Provider"
                  value={config.connectionProvider}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            connectionProvider: event.target.value === "gateway" ? "gateway" : "mock"
                          }
                        : prev
                    )
                  }
                  fullWidth
                >
                  <MenuItem value="mock">Mock (deterministic)</MenuItem>
                  <MenuItem value="gateway">Gateway Provider</MenuItem>
                </TextField>
                <TextField
                  select
                  label="Provider"
                  value={config.providerId ?? ""}
                  onChange={(event) =>
                    setConfig((prev) =>
                      prev
                        ? {
                            ...prev,
                            providerId: event.target.value ? Number(event.target.value) : null
                          }
                        : prev
                    )
                  }
                  fullWidth
                >
                  <MenuItem value="">Use default provider</MenuItem>
                  {providerOptions.map((provider) => (
                    <MenuItem key={provider.id} value={provider.id} disabled={!provider.enabled}>
                      {provider.name}
                      {provider.model ? ` (${provider.model})` : ""}
                      {!provider.enabled ? " - disabled" : ""}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Model Name Override"
                  value={config.modelName || ""}
                  onChange={(event) => setConfig((prev) => (prev ? { ...prev, modelName: event.target.value } : prev))}
                  placeholder="e.g. gpt-4.1-mini"
                  fullWidth
                />
              </Box>

              <TextField
                label="Endpoint Override"
                value={config.endpoint || ""}
                onChange={(event) => setConfig((prev) => (prev ? { ...prev, endpoint: event.target.value } : prev))}
                placeholder="https://provider.example/v1"
                helperText="Optional. Leave empty to use the selected provider endpoint."
                fullWidth
              />

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 2fr) repeat(3, minmax(0, 1fr))" },
                  gap: 2
                }}
              >
                <Box sx={{ display: "grid", gap: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <KeyIcon fontSize="small" />
                    <Typography variant="subtitle2">Provider API Key</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {config.providerApiKeyConfigured
                      ? `Configured (${config.providerApiKeyMasked || "masked"})`
                      : "No API key configured"}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      type="button"
                      variant={replaceProviderKey ? "contained" : "outlined"}
                      size="small"
                      onClick={() => {
                        setReplaceProviderKey((prev) => {
                          const next = !prev;
                          if (!next) setProviderKeyInput("");
                          return next;
                        });
                        if (!replaceProviderKey) setClearProviderKey(false);
                      }}
                    >
                      {replaceProviderKey ? "Cancel replace" : "Replace key"}
                    </Button>
                    {config.providerApiKeyConfigured ? (
                      <FormControlLabel
                        sx={{ m: 0 }}
                        control={
                          <Checkbox
                            size="small"
                            checked={clearProviderKey}
                            onChange={(event) => {
                              setClearProviderKey(event.target.checked);
                              if (event.target.checked) {
                                setReplaceProviderKey(false);
                                setProviderKeyInput("");
                              }
                            }}
                          />
                        }
                        label={<Typography variant="body2">Clear stored key on save</Typography>}
                      />
                    ) : null}
                  </Stack>
                  {replaceProviderKey ? (
                    <TextField
                      type="password"
                      value={providerKeyInput}
                      onChange={(event) => setProviderKeyInput(event.target.value)}
                      placeholder="Enter new API key"
                      autoComplete="off"
                      fullWidth
                    />
                  ) : null}
                </Box>
                <TextField
                  label="Provider Org"
                  value={config.providerOrg || ""}
                  onChange={(event) => setConfig((prev) => (prev ? { ...prev, providerOrg: event.target.value || null } : prev))}
                  placeholder="Optional"
                  fullWidth
                />
                <TextField
                  label="Provider Project"
                  value={config.providerProject || ""}
                  onChange={(event) => setConfig((prev) => (prev ? { ...prev, providerProject: event.target.value || null } : prev))}
                  placeholder="Optional"
                  fullWidth
                />
                <TextField
                  label="Provider Region"
                  value={config.providerRegion || ""}
                  onChange={(event) => setConfig((prev) => (prev ? { ...prev, providerRegion: event.target.value || null } : prev))}
                  placeholder="Optional"
                  fullWidth
                />
              </Box>

              <Divider />

              <FormControlLabel
                control={
                  <Switch
                    checked={config.mockMode}
                    onChange={(event) => setConfig((prev) => (prev ? { ...prev, mockMode: event.target.checked } : prev))}
                  />
                }
                label={
                  <Box>
                    <Typography variant="subtitle2">Mock mode</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Deterministic responses with no external LLM call.
                    </Typography>
                  </Box>
                }
              />

              <TextField
                label="System Prompt"
                multiline
                minRows={6}
                value={config.systemPrompt || ""}
                onChange={(event) => setConfig((prev) => (prev ? { ...prev, systemPrompt: event.target.value } : prev))}
                helperText="Visible only to admins. Not exposed to clients."
                fullWidth
              />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Enabled Tools
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
                    gap: 1.25
                  }}
                >
                  {visibleTools.map((tool) => {
                    const checked = config.enabledTools.includes(tool);
                    return (
                      <Card key={tool} variant="outlined" elevation={0}>
                        <CardContent sx={{ py: 1.25, px: 1.5, "&:last-child": { pb: 1.25 } }}>
                          <FormControlLabel
                            sx={{ alignItems: "flex-start", m: 0 }}
                            control={
                              <Checkbox
                                checked={checked}
                                onChange={(event) => {
                                  const nextSet = new Set(config.enabledTools);
                                  if (event.target.checked) {
                                    nextSet.add(tool);
                                  } else {
                                    nextSet.delete(tool);
                                  }
                                  setConfig((prev) =>
                                    prev ? { ...prev, enabledTools: Array.from(nextSet) as AppAgentToolName[] } : prev
                                  );
                                }}
                              />
                            }
                            label={
                              <Box sx={{ pt: 0.55 }}>
                                <Typography variant="subtitle2">{TOOL_LABELS[tool] || tool}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {TOOL_DESCRIPTIONS[tool] || ""}
                                </Typography>
                              </Box>
                            }
                          />
                        </CardContent>
                      </Card>
                    );
                  })}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Language pairs are taken automatically from the global Language Settings admin tab.
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
          <Typography variant="body2" color="text.secondary">
            Changes apply via hot reload. Updated by {config.updatedBy || currentUser.username}.
          </Typography>
          <Button
            type="button"
            variant="contained"
            color="primary"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving..." : "Save App Agent Config"}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
