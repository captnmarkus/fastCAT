import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentChatMessage, AgentChatThread, FileTypeConfig, InboxItem, Project } from "../../api";
import {
  createChatThread,
  deleteChatThread,
  getOrCreateChatUploadSession,
  listEnabledFileTypeConfigs,
  listChatMessages,
  listChatThreads,
  listInboxItems,
  listProjects,
  postChatMessage,
  streamChatResponse,
  uploadProjectFile,
  updateChatThread
} from "../../api";

type UiMessage = Omit<AgentChatMessage, "id"> & { id: number | string };

type QuickAction = {
  id: string;
  label: string;
  payload?: Record<string, any>;
};

type ProjectPanelItem = {
  projectId: number;
  name: string;
  status: string;
  progressPct: number;
  lastUpdatedAt: string;
  languageLabel: string;
};

type UploadFileType = "html" | "xml" | "pdf" | "docx" | "pptx" | "xlsx" | "other";

type UploadedChatFile = {
  fileId: number;
  filename: string;
  fileType: Exclude<UploadFileType, "other">;
};

const FILE_TYPE_EXTENSIONS: Record<Exclude<UploadFileType, "other">, string[]> = {
  html: [".html", ".htm", ".xhtml", ".xtml"],
  xml: [".xml", ".xlf", ".xliff"],
  pdf: [".pdf"],
  docx: [".doc", ".docx"],
  pptx: [".ppt", ".pptx"],
  xlsx: [".xls", ".xlsx"]
};

const FILE_TYPE_LABELS: Record<Exclude<UploadFileType, "other">, string> = {
  html: "HTML",
  xml: "XML / XLIFF",
  pdf: "PDF",
  docx: "DOC / DOCX",
  pptx: "PPT / PPTX",
  xlsx: "XLS / XLSX"
};

function detectChatUploadFileType(file: File): UploadFileType {
  const name = String(file?.name || "").trim().toLowerCase();
  if (!name) return "other";
  if (name.endsWith(".xlf") || name.endsWith(".xliff") || name.endsWith(".xml")) return "xml";
  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xhtml") || name.endsWith(".xtml")) {
    return "html";
  }
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".doc") || name.endsWith(".docx")) return "docx";
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return "xlsx";
  return "other";
}

function getQuickActions(message: UiMessage): QuickAction[] {
  if (message.role !== "assistant" || !message.contentJson) return [];
  const raw = (message.contentJson as any).quickActions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => ({
      id: String(entry?.id || ""),
      label: String(entry?.label || ""),
      payload: entry?.payload && typeof entry.payload === "object" ? entry.payload : {}
    }))
    .filter((entry: QuickAction) => entry.id && entry.label);
}

function normalizeProjectPanelItems(projects: Project[], inboxItems: InboxItem[]): ProjectPanelItem[] {
  const progressMap = new Map<number, { total: number; count: number; lastUpdatedAt: string }>();
  inboxItems.forEach((item) => {
    const projectId = Number(item.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    const existing = progressMap.get(projectId) || {
      total: 0,
      count: 0,
      lastUpdatedAt: item.lastUpdatedAt || item.createdAt
    };
    existing.total += Number(item.progressPct || 0);
    existing.count += 1;
    const nextUpdatedAt = item.lastUpdatedAt || item.createdAt;
    if (new Date(nextUpdatedAt).getTime() > new Date(existing.lastUpdatedAt).getTime()) {
      existing.lastUpdatedAt = nextUpdatedAt;
    }
    progressMap.set(projectId, existing);
  });

  return projects
    .map((project) => {
      const progress = progressMap.get(Number(project.id));
      const progressPct =
        progress && progress.count > 0 ? Math.max(0, Math.min(100, Math.round(progress.total / progress.count))) : 0;
      const lastUpdatedAt = project.lastModifiedAt || progress?.lastUpdatedAt || project.createdAt;
      const targetLabel =
        Array.isArray(project.targetLangs) && project.targetLangs.length > 0
          ? project.targetLangs.join(", ")
          : project.tgtLang;
      return {
        projectId: Number(project.id),
        name: String(project.name || ""),
        status: String(project.status || ""),
        progressPct,
        lastUpdatedAt: new Date(lastUpdatedAt).toISOString(),
        languageLabel: `${project.srcLang} -> ${targetLabel}`
      };
    })
    .sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime())
    .slice(0, 10);
}

function mergeUploadedFiles(
  current: UploadedChatFile[],
  incoming: UploadedChatFile[]
): UploadedChatFile[] {
  const merged = new Map<number, UploadedChatFile>();
  current.forEach((entry) => merged.set(entry.fileId, entry));
  incoming.forEach((entry) => merged.set(entry.fileId, entry));
  return Array.from(merged.values());
}

function serializeUploadedFiles(files: UploadedChatFile[]) {
  return files.map((entry) => ({
    fileId: entry.fileId,
    filename: entry.filename,
    fileType: entry.fileType
  }));
}

function mergeContentJsonWithUploadedFiles(
  contentJson: Record<string, any> | null | undefined,
  uploadedFiles: UploadedChatFile[]
): Record<string, any> | null {
  const merged: Record<string, any> = contentJson ? { ...contentJson } : {};
  if (uploadedFiles.length === 0) {
    return Object.keys(merged).length > 0 ? merged : null;
  }

  const existingUploaded = Array.isArray(merged.uploadedFiles)
    ? merged.uploadedFiles
        .map((entry: any) => ({
          fileId: Number(entry?.fileId),
          filename: String(entry?.filename || ""),
          fileType: String(entry?.fileType || "") as UploadedChatFile["fileType"]
        }))
        .filter((entry: UploadedChatFile) => Number.isFinite(entry.fileId) && entry.fileId > 0)
    : [];

  merged.uploadedFiles = serializeUploadedFiles(mergeUploadedFiles(existingUploaded, uploadedFiles));
  return merged;
}

function isWizardWaitingForFiles(messages: UiMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || entry.role !== "assistant") continue;
    const wizard = (entry.contentJson as any)?.wizard;
    return Boolean(wizard?.active) && String(wizard?.step || "").trim().toLowerCase() === "files";
  }
  return false;
}

export default function ChatPanel() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<AgentChatThread[]>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadMenuOpenFor, setThreadMenuOpenFor] = useState<number | null>(null);
  const [threadsCollapsed, setThreadsCollapsed] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectItems, setProjectItems] = useState<ProjectPanelItem[]>([]);
  const [chatUploadProjectId, setChatUploadProjectId] = useState<number | null>(null);
  const [chatUploadConfigsLoaded, setChatUploadConfigsLoaded] = useState(false);
  const [chatUploadConfigs, setChatUploadConfigs] = useState<FileTypeConfig[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pendingUploadedFiles, setPendingUploadedFiles] = useState<UploadedChatFile[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const activeThreadIdRef = useRef<number | null>(null);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const activeThread = useMemo(
    () => threads.find((entry) => entry.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const filteredThreads = useMemo(() => {
    const needle = threadSearch.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((thread) => String(thread.title || "").toLowerCase().includes(needle));
  }, [threads, threadSearch]);

  const chatUploadConfigByType = useMemo(() => {
    const parseBooleanFlag = (value: unknown): boolean => {
      if (typeof value === "boolean") return value;
      const raw = String(value ?? "").trim().toLowerCase();
      return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
    };

    const bestByType = new Map<Exclude<UploadFileType, "other">, { id: number; agentDefault: boolean }>();
    chatUploadConfigs.forEach((config) => {
      const fileType = String((config as any)?.config?.fileType || "").trim().toLowerCase() as UploadFileType;
      if (
        fileType === "html" ||
        fileType === "xml" ||
        fileType === "pdf" ||
        fileType === "docx" ||
        fileType === "pptx" ||
        fileType === "xlsx"
      ) {
        const configId = Number(config.id);
        if (!Number.isFinite(configId) || configId <= 0) return;
        const cfg = ((config as any)?.config || {}) as Record<string, unknown>;
        const candidate = {
          id: configId,
          agentDefault: parseBooleanFlag(cfg.agentDefault) || parseBooleanFlag(cfg.appAgentDefault)
        };
        const current = bestByType.get(fileType);
        if (!current || (candidate.agentDefault && !current.agentDefault)) {
          bestByType.set(fileType, candidate);
        }
      }
    });

    const map = new Map<Exclude<UploadFileType, "other">, number>();
    bestByType.forEach((entry, fileType) => {
      map.set(fileType, entry.id);
    });
    return map;
  }, [chatUploadConfigs]);

  const chatUploadAccept = useMemo(() => {
    const extensions = new Set<string>();
    chatUploadConfigByType.forEach((_, fileType) => {
      (FILE_TYPE_EXTENSIONS[fileType] || []).forEach((ext) => extensions.add(ext));
    });
    return Array.from(extensions).join(",");
  }, [chatUploadConfigByType]);

  const loadCurrentProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const [projects, inboxItems] = await Promise.all([
        listProjects({ scope: "current" }),
        listInboxItems()
      ]);
      setProjectItems(normalizeProjectPanelItems(projects, inboxItems));
    } catch (err: any) {
      setProjectsError(err?.userMessage || err?.message || "Failed to load current projects.");
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const loadChatUploadConfigs = useCallback(async () => {
    setChatUploadConfigsLoaded(false);
    try {
      const configs = await listEnabledFileTypeConfigs();
      setChatUploadConfigs(configs);
    } catch {
      setChatUploadConfigs([]);
    } finally {
      setChatUploadConfigsLoaded(true);
    }
  }, []);

  const loadThreads = useCallback(async (preferredThreadId?: number | null) => {
    const existing = await listChatThreads();
    const resolved = existing.length > 0 ? existing : [await createChatThread({ title: "New chat" })];
    let selected =
      (preferredThreadId != null ? resolved.find((entry) => entry.id === preferredThreadId) : null) || null;
    if (!selected && activeThreadIdRef.current != null) {
      selected = resolved.find((entry) => entry.id === activeThreadIdRef.current) || null;
    }
    if (!selected) selected = resolved[0] || null;
    setThreads(resolved);
    setActiveThreadId(selected?.id ?? null);
    return selected;
  }, []);

  const loadMessages = useCallback(async (threadId: number) => {
    setLoadingMessages(true);
    setError(null);
    try {
      const next = await listChatMessages(threadId);
      setMessages(next);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to load chat messages.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadThreads(), loadCurrentProjects(), loadChatUploadConfigs()])
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.userMessage || err?.message || "Failed to initialize chat.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      streamAbortRef.current?.abort();
    };
  }, [loadThreads, loadCurrentProjects, loadChatUploadConfigs]);

  useEffect(() => {
    if (!activeThreadId) return;
    void loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages]);

  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (threadMenuOpenFor == null) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".fc-chat-thread-menu-wrap")) return;
      setThreadMenuOpenFor(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [threadMenuOpenFor]);

  const sendMessage = useCallback(
    async (
      text: string,
      opts?: {
        contentJson?: Record<string, any> | null;
        clearPendingUploads?: boolean;
        includePendingUploads?: boolean;
      }
    ) => {
      const trimmed = String(text || "").trim();
      if (!trimmed || submitting) return;

      setSubmitting(true);
      setError(null);
      setStreamStatus(null);

      const pendingForMessage = opts?.includePendingUploads === false ? [] : pendingUploadedFiles;
      const mergedContentJson = mergeContentJsonWithUploadedFiles(opts?.contentJson, pendingForMessage);

      const threadId = activeThreadId ?? (await loadThreads())?.id;
      if (!threadId) {
        setSubmitting(false);
        return;
      }

      const optimisticUserMessage: UiMessage = {
        id: `temp-user-${Date.now()}`,
        threadId,
        userId: 0,
        role: "user",
        contentText: trimmed,
        contentJson: mergedContentJson,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, optimisticUserMessage]);
      setDraft("");
      setThreads((prev) =>
        prev.map((entry) =>
          entry.id === threadId ? { ...entry, updatedAt: new Date().toISOString() } : entry
        )
      );

      try {
        const start = await postChatMessage(threadId, {
          contentText: trimmed,
          contentJson: mergedContentJson
        });
        setMessages((prev) => prev.map((entry) => (entry.id === optimisticUserMessage.id ? start.userMessage : entry)));
        if ((opts?.clearPendingUploads ?? true) && pendingForMessage.length > 0) {
          const sentFileIds = new Set(pendingForMessage.map((entry) => entry.fileId));
          setPendingUploadedFiles((prev) => prev.filter((entry) => !sentFileIds.has(entry.fileId)));
        }

        const draftAssistantId = `draft-assistant-${start.requestId}`;
        setMessages((prev) => [
          ...prev,
          {
            id: draftAssistantId,
            threadId,
            userId: start.userMessage.userId,
            role: "assistant",
            contentText: "",
            contentJson: null,
            createdAt: new Date().toISOString()
          }
        ]);

        streamAbortRef.current?.abort();
        const abortController = new AbortController();
        streamAbortRef.current = abortController;

        await streamChatResponse({
          threadId,
          requestId: start.requestId,
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === "token") {
              setMessages((prev) =>
                prev.map((entry) =>
                  entry.id === draftAssistantId
                    ? { ...entry, contentText: `${entry.contentText}${event.token}` }
                    : entry
                )
              );
              return;
            }
            if (event.type === "tool_call") {
              if (event.status === "started") setStreamStatus(event.message || `Running ${event.toolName}...`);
              if (event.status === "succeeded") {
                setStreamStatus(event.message || `${event.toolName} completed.`);
                void loadCurrentProjects();
              }
              if (event.status === "failed") setStreamStatus(event.message || `${event.toolName} failed.`);
              return;
            }
            if (event.type === "final") {
              setMessages((prev) => {
                const withoutDraft = prev.filter((entry) => entry.id !== draftAssistantId);
                const alreadyPresent = withoutDraft.some((entry) => Number(entry.id) === Number(event.message.id));
                if (alreadyPresent) return withoutDraft;
                return [...withoutDraft, event.message];
              });
              setStreamStatus(null);
              void loadCurrentProjects();
              return;
            }
            if (event.type === "error") {
              setError(event.message || "Assistant request failed.");
              setStreamStatus(null);
              setMessages((prev) => prev.filter((entry) => entry.id !== draftAssistantId));
            }
          }
        });
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setError(err?.userMessage || err?.message || "Failed to send message.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [activeThreadId, loadCurrentProjects, loadThreads, pendingUploadedFiles, submitting]
  );

  const handleUploadFiles = useCallback(
    async (files: FileList | null) => {
      const selected = Array.from(files || []);
      if (selected.length === 0) return;

      if (chatUploadConfigByType.size === 0) {
        setError("No File Type Configuration is available. Configure file types first in Resources.");
        return;
      }

      setUploadingFiles(true);
      setError(null);
      setStreamStatus(`Uploading ${selected.length} file(s)...`);

      try {
        let projectId = chatUploadProjectId;
        if (!projectId) {
          const session = await getOrCreateChatUploadSession();
          projectId = Number(session.projectId);
          if (!Number.isFinite(projectId) || projectId <= 0) {
            throw new Error("Failed to initialize chat upload session.");
          }
          setChatUploadProjectId(projectId);
        }

        const uploaded: UploadedChatFile[] = [];
        const rejected: string[] = [];
        const failed: string[] = [];

        for (const file of selected) {
          const fileType = detectChatUploadFileType(file);
          if (fileType === "other") {
            rejected.push(file.name);
            continue;
          }
          const fileTypeConfigId = chatUploadConfigByType.get(fileType);
          if (!fileTypeConfigId) {
            rejected.push(file.name);
            continue;
          }

          try {
            const result = await uploadProjectFile(projectId, file, { fileTypeConfigId });
            uploaded.push({
              fileId: Number(result.fileId),
              filename: file.name,
              fileType
            });
          } catch (err: any) {
            failed.push(`${file.name}: ${err?.userMessage || err?.message || "Upload failed"}`);
          }
        }

        const shouldAutoSendUploadedFiles =
          uploaded.length > 0 && isWizardWaitingForFiles(messages) && !draft.trim();

        if (uploaded.length > 0 && !shouldAutoSendUploadedFiles) {
          setPendingUploadedFiles((prev) => mergeUploadedFiles(prev, uploaded));
        }

        const statusParts: string[] = [];
        if (uploaded.length > 0) statusParts.push(`Uploaded ${uploaded.length} file(s).`);
        if (rejected.length > 0) statusParts.push(`Skipped ${rejected.length} unsupported file(s).`);
        if (failed.length > 0) statusParts.push(`Failed ${failed.length} file(s).`);
        setStreamStatus(statusParts.length > 0 ? statusParts.join(" ") : null);

        if (rejected.length > 0) {
          const configured = Array.from(chatUploadConfigByType.keys())
            .map((type) => FILE_TYPE_LABELS[type])
            .join(", ");
          setError(`Some files are not configured for upload (${rejected.join(", ")}). Allowed: ${configured}.`);
        } else if (failed.length > 0) {
          setError(failed.join(" | "));
        }

        if (shouldAutoSendUploadedFiles) {
          const filesForMessage = mergeUploadedFiles(pendingUploadedFiles, uploaded);
          setPendingUploadedFiles([]);
          void sendMessage("I uploaded the requested file(s).", {
            contentJson: {
              uploadedFiles: serializeUploadedFiles(filesForMessage)
            },
            clearPendingUploads: false,
            includePendingUploads: false
          });
        }
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to upload files.");
        setStreamStatus(null);
      } finally {
        setUploadingFiles(false);
      }
    },
    [chatUploadConfigByType, chatUploadProjectId, draft, messages, pendingUploadedFiles, sendMessage]
  );

  const handleOpenFilePicker = useCallback(() => {
    if (uploadingFiles || submitting || threadBusy) return;
    if (chatUploadConfigsLoaded && chatUploadConfigByType.size === 0) {
      setError("No File Type Configuration is available. Configure file types first in Resources.");
      return;
    }
    fileInputRef.current?.click();
  }, [chatUploadConfigByType, chatUploadConfigsLoaded, submitting, threadBusy, uploadingFiles]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await sendMessage(draft);
    },
    [sendMessage, draft]
  );

  const handleQuickAction = useCallback(
    async (action: QuickAction) => {
      const payload = action.payload || {};
      if (payload.type === "open_project" && Number.isFinite(Number(payload.projectId))) {
        navigate(`/projects/${Number(payload.projectId)}`);
        return;
      }
      if (payload.type === "open_project_provisioning" && Number.isFinite(Number(payload.projectId))) {
        navigate(`/projects/${Number(payload.projectId)}/provisioning`);
        return;
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        await sendMessage(payload.message);
        return;
      }
      setDraft(action.label);
    },
    [navigate, sendMessage]
  );

  const handleCreateThread = useCallback(async () => {
    if (threadBusy) return;
    setThreadBusy(true);
    setError(null);
    try {
      const created = await createChatThread({ title: "New chat" });
      await loadThreads(created.id);
      setMobileThreadsOpen(false);
    } catch (err: any) {
      setError(err?.userMessage || err?.message || "Failed to create thread.");
    } finally {
      setThreadBusy(false);
    }
  }, [threadBusy, loadThreads]);

  const handleRenameThread = useCallback(
    async (thread: AgentChatThread) => {
      if (threadBusy || submitting) return;
      const currentTitle = String(thread.title || "").trim() || `Chat #${thread.id}`;
      const nextTitle = window.prompt("Rename chat", currentTitle);
      if (nextTitle == null) return;
      const normalized = nextTitle.trim();
      if (!normalized || normalized === currentTitle) return;

      setThreadBusy(true);
      setError(null);
      try {
        await updateChatThread(thread.id, { title: normalized });
        await loadThreads(thread.id);
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to rename chat.");
      } finally {
        setThreadBusy(false);
      }
    },
    [loadThreads, submitting, threadBusy]
  );

  const handleDeleteThread = useCallback(
    async (threadId: number) => {
      if (threadBusy || submitting) return;
      const confirmed = window.confirm("Delete this chat? This cannot be undone.");
      if (!confirmed) return;

      setThreadBusy(true);
      setError(null);
      try {
        await deleteChatThread(threadId);
        const preferred = activeThreadIdRef.current === threadId ? null : activeThreadIdRef.current;
        await loadThreads(preferred);
      } catch (err: any) {
        setError(err?.userMessage || err?.message || "Failed to delete chat.");
      } finally {
        setThreadBusy(false);
      }
    },
    [loadThreads, submitting, threadBusy]
  );

  const renderThreadSidebar = (mobile = false) => (
    <div className={`fc-chat-sidebar-inner${mobile ? " is-mobile" : ""}`}>
      <div className="fc-chat-sidebar-header">
        <button
          type="button"
          className="fc-chat-new-thread-btn"
          onClick={handleCreateThread}
          disabled={threadBusy || submitting}
        >
          <i className="bi bi-pencil" aria-hidden="true" />
          <span>New chat</span>
        </button>
        {mobile ? (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setMobileThreadsOpen(false)}
          >
            Close
          </button>
        ) : (
          <button
            type="button"
            className="fc-chat-panel-collapse-btn"
            onClick={() => setThreadsCollapsed(true)}
            aria-label="Collapse chat history"
            title="Collapse chat history"
          >
            <i className="bi bi-layout-sidebar-inset-reverse" aria-hidden="true" />
          </button>
        )}
      </div>
      <input
        className="form-control form-control-sm"
        value={threadSearch}
        onChange={(event) => setThreadSearch(event.target.value)}
        placeholder="Search chats"
      />
      <div className="fc-chat-thread-list">
        {filteredThreads.length === 0 ? (
          <div className="text-muted small px-1">No chats found.</div>
        ) : (
          filteredThreads.map((thread) => (
            <div key={thread.id} className={`fc-chat-thread-item${thread.id === activeThreadId ? " is-active" : ""}`}>
              <button
                type="button"
                className="fc-chat-thread-select"
                onClick={() => {
                  setActiveThreadId(thread.id);
                  setMobileThreadsOpen(false);
                  setThreadMenuOpenFor(null);
                }}
              >
                <div className="fc-chat-thread-title">{thread.title || `Chat #${thread.id}`}</div>
                <div className="fc-chat-thread-meta">
                  {new Date(thread.updatedAt).toLocaleDateString()}
                </div>
              </button>
              <div className="fc-chat-thread-menu-wrap">
                <button
                  type="button"
                  className="fc-chat-thread-menu-toggle"
                  aria-label="Open chat actions"
                  title="Chat actions"
                  aria-expanded={threadMenuOpenFor === thread.id}
                  disabled={threadBusy || submitting}
                  onClick={(event) => {
                    event.stopPropagation();
                    setThreadMenuOpenFor((openId) => (openId === thread.id ? null : thread.id));
                  }}
                >
                  <i className="bi bi-three-dots" aria-hidden="true" />
                </button>
                {threadMenuOpenFor === thread.id ? (
                  <div className="fc-chat-thread-menu" role="menu">
                    <button
                      type="button"
                      className="fc-chat-thread-menu-item"
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation();
                        setThreadMenuOpenFor(null);
                        void handleRenameThread(thread);
                      }}
                    >
                      <i className="bi bi-pencil" aria-hidden="true" />
                      <span>Rename</span>
                    </button>
                    <button
                      type="button"
                      className="fc-chat-thread-menu-item is-danger"
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation();
                        setThreadMenuOpenFor(null);
                        void handleDeleteThread(thread.id);
                      }}
                    >
                      <i className="bi bi-trash3" aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  if (loading) {
    return <section className="card-enterprise fc-chat-shell p-3 text-muted">Loading assistant...</section>;
  }

  return (
    <section
      className={`card-enterprise fc-chat-shell${threadsCollapsed ? " is-threads-collapsed" : ""}${projectsCollapsed ? " is-projects-collapsed" : ""}`}
    >
      <aside className="fc-chat-sidebar">{renderThreadSidebar(false)}</aside>

      <section className="fc-chat-main">
        <header className="fc-chat-main-header">
          <div>
            <div className="fc-chat-main-kicker">App Agent</div>
            <h2 className="fc-chat-main-title">{activeThread?.title || "Chat"}</h2>
          </div>
          <div className="fc-chat-main-actions">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm fc-chat-mobile-threads-btn"
              onClick={() => setMobileThreadsOpen(true)}
            >
              Threads
            </button>
            <button
              type="button"
              className="fc-chat-header-toggle"
              onClick={() => setThreadsCollapsed((value) => !value)}
              aria-label={threadsCollapsed ? "Show chat history" : "Hide chat history"}
            >
              <i className={`bi ${threadsCollapsed ? "bi-layout-sidebar-inset" : "bi-layout-sidebar"}`} aria-hidden="true" />
              <span>{threadsCollapsed ? "Show chats" : "Hide chats"}</span>
            </button>
            <button
              type="button"
              className="fc-chat-header-toggle"
              onClick={() => setProjectsCollapsed((value) => !value)}
              aria-label={projectsCollapsed ? "Show current projects" : "Hide current projects"}
            >
              <i className={`bi ${projectsCollapsed ? "bi-layout-sidebar-inset" : "bi-layout-sidebar-reverse"}`} aria-hidden="true" />
              <span>{projectsCollapsed ? "Show projects" : "Hide projects"}</span>
            </button>
          </div>
        </header>

        <div className="fc-chat-main-body">
          <div className="fc-chat-main-window">
            <div className="fc-chat-messages" ref={messagesRef}>
              {loadingMessages ? (
                <div className="text-muted small">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-muted small">
                  Ask for a translation snippet or upload a file and I will guide you through project creation one step at a time.
                </div>
              ) : (
                messages.map((message) => {
                  const actions = getQuickActions(message);
                  const isDraftAssistant =
                    message.role === "assistant" &&
                    typeof message.id === "string" &&
                    message.id.startsWith("draft-assistant-");
                  return (
                    <article
                      key={String(message.id)}
                      className={`fc-chat-message is-${message.role}${isDraftAssistant ? " is-draft" : ""}`}
                    >
                      <div className="fc-chat-message-text">
                        {message.contentText || (isDraftAssistant ? "Thinking..." : "")}
                        {isDraftAssistant ? <span className="fc-chat-message-cursor" aria-hidden="true" /> : null}
                      </div>
                      {actions.length > 0 ? (
                        <div className="fc-chat-quick-actions">
                          {actions.map((action) => (
                            <button
                              key={action.id}
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => handleQuickAction(action)}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>

            {streamStatus ? <div className="fc-chat-stream-status">{streamStatus}</div> : null}
            {error ? <div className="alert alert-danger mb-0 mx-3 mb-2">{error}</div> : null}

            <form className="fc-chat-composer" onSubmit={handleSubmit}>
              <div className={`fc-chat-compose-shell${submitting || uploadingFiles ? " is-busy" : ""}`}>
                {pendingUploadedFiles.length > 0 ? (
                  <div className="fc-chat-upload-pillbar">
                    <div className="fc-chat-upload-pillbar-label">Ready for the next message</div>
                    <div className="fc-chat-upload-pillbar-items">
                      {pendingUploadedFiles.map((file) => (
                        <span key={file.fileId} className="fc-chat-upload-pill">
                          {file.filename}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <textarea
                  className="form-control fc-chat-compose-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Ask me anything..."
                  rows={2}
                  disabled={submitting || threadBusy || uploadingFiles}
                />
                <div className="fc-chat-compose-footer">
                  <div className="fc-chat-compose-left">
                    <button
                      type="button"
                      className="fc-chat-compose-iconbtn"
                      disabled={submitting || threadBusy || uploadingFiles || !chatUploadConfigsLoaded}
                      onClick={handleOpenFilePicker}
                      aria-label="Upload files"
                      title="Upload files"
                    >
                      <i className="bi bi-plus-lg" aria-hidden="true" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="d-none"
                      multiple
                      accept={chatUploadAccept || undefined}
                      onChange={(event) => {
                        void handleUploadFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                      aria-label="Upload files for App Agent"
                    />
                  </div>
                  <div className="fc-chat-compose-right">
                    <button
                      type="button"
                      className="fc-chat-compose-iconbtn"
                      disabled
                      aria-label="Voice input (coming soon)"
                      title="Voice input (coming soon)"
                    >
                      <i className="bi bi-mic" aria-hidden="true" />
                    </button>
                    <button
                      type="submit"
                      className="fc-chat-compose-send"
                      disabled={submitting || threadBusy || uploadingFiles || !draft.trim()}
                      aria-label={submitting ? "Sending message" : "Send message"}
                    >
                      <i className={`bi ${submitting ? "bi-hourglass-split" : "bi-send-fill"}`} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>

      <aside className="fc-chat-projects-panel">
        <div className="fc-chat-projects-header">
          <h3>Current Projects</h3>
          <div className="fc-chat-projects-header-actions">
            <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={() => void loadCurrentProjects()}>
              Refresh
            </button>
            <button
              type="button"
              className="fc-chat-panel-collapse-btn"
              onClick={() => setProjectsCollapsed(true)}
              aria-label="Collapse current projects"
              title="Collapse current projects"
            >
              <i className="bi bi-layout-sidebar-inset" aria-hidden="true" />
            </button>
          </div>
        </div>
        {projectsLoading ? (
          <div className="text-muted small">Loading projects...</div>
        ) : projectsError ? (
          <div className="text-danger small">{projectsError}</div>
        ) : projectItems.length === 0 ? (
          <div className="text-muted small">No current projects yet.</div>
        ) : (
          <div className="fc-chat-projects-list">
            {projectItems.map((project) => (
              <button
                key={project.projectId}
                type="button"
                className="fc-chat-project-item"
                onClick={() => navigate(`/projects/${project.projectId}`)}
              >
                <div className="fc-chat-project-top">
                  <div className="fc-chat-project-name">{project.name}</div>
                  <span className="badge text-bg-light text-uppercase">{project.status}</span>
                </div>
                <div className="fc-chat-project-meta">{project.languageLabel}</div>
                <div className="progress fc-chat-project-progress" role="progressbar" aria-valuenow={project.progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-bar" style={{ width: `${project.progressPct}%` }} />
                </div>
                <div className="fc-chat-project-meta">Updated {new Date(project.lastUpdatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        )}
      </aside>

      {mobileThreadsOpen ? (
        <div className="fc-chat-mobile-overlay">
          <div className="fc-chat-mobile-sidebar">{renderThreadSidebar(true)}</div>
        </div>
      ) : null}
    </section>
  );
}
