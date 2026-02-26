import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../../../types/app";
import {
  adminListUsers,
  downloadChatUsageCsv,
  downloadUsageCsv,
  fetchChatUsageSummary,
  fetchUsageSummary,
  type AdminUser,
  listChatAuditEvents,
  type ChatAuditEvent,
  type ChatUsageSummary,
  type UsageSummary
} from "../../../api";
import { formatActorLabel } from "../../../utils/actors";
import { triggerFileDownload } from "../../../utils/download";
import { buildUserLabelMap } from "../../../utils/userLabels";

export default function StatsTab({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [chatUsageSummary, setChatUsageSummary] = useState<ChatUsageSummary | null>(null);
  const [chatAuditEvents, setChatAuditEvents] = useState<ChatAuditEvent[]>([]);
  const [chatAuditLoading, setChatAuditLoading] = useState(false);
  const [chatAuditLimit, setChatAuditLimit] = useState(50);
  const [chatAuditEventType, setChatAuditEventType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingChat, setDownloadingChat] = useState(false);

  const userLabelMap = useMemo(() => buildUserLabelMap(users), [users]);
  const chatAuditOptions = useMemo(
    () => [
      "",
      "chat_request_started",
      "chat_request_completed",
      "chat_request_failed",
      "tool_call_started",
      "tool_call_succeeded",
      "tool_call_failed"
    ],
    []
  );

  const loadChatAuditEvents = useCallback(async () => {
    setChatAuditLoading(true);
    try {
      const events = await listChatAuditEvents({
        limit: chatAuditLimit,
        eventType: chatAuditEventType || undefined
      });
      setChatAuditEvents(events);
    } catch (err: any) {
      setError(err?.message || "Failed to load chat audit events");
    } finally {
      setChatAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [userList, usage, chatUsage, chatAudit] = await Promise.all([
          adminListUsers(),
          fetchUsageSummary(),
          fetchChatUsageSummary(),
          listChatAuditEvents({
            limit: chatAuditLimit,
            eventType: chatAuditEventType || undefined
          })
        ]);
        if (cancelled) return;
        setUsers(userList);
        setUsageSummary(usage);
        setChatUsageSummary(chatUsage);
        setChatAuditEvents(chatAudit);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load usage stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatAuditLimit, chatAuditEventType]);

  async function handleDownload() {
    if (currentUser.role !== "admin") return;
    setError(null);
    setDownloading(true);
    try {
      const blob = await downloadUsageCsv();
      const filename = `usage-${new Date().toISOString().slice(0, 10)}.csv`;
      triggerFileDownload(blob, filename);
    } catch (err: any) {
      setError(err?.message || "Failed to download usage");
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadChatUsage() {
    if (currentUser.role !== "admin") return;
    setError(null);
    setDownloadingChat(true);
    try {
      const blob = await downloadChatUsageCsv();
      const filename = `chat-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      triggerFileDownload(blob, filename);
    } catch (err: any) {
      setError(err?.message || "Failed to download chat usage");
    } finally {
      setDownloadingChat(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center text-muted py-5">
        <span className="spinner-border" />
      </div>
    );
  }

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        {error && <div className="alert alert-danger">{error}</div>}

        {!usageSummary ? (
          <div className="text-muted">No usage data available.</div>
        ) : (
          <>
            <div className="d-flex justify-content-end mb-3">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? "Downloading..." : "Download CSV"}
              </button>
            </div>
            <div className="d-flex gap-4 flex-wrap mb-3">
              <div>
                <div className="text-muted small">Projects</div>
                <div className="h5 mb-0">{usageSummary.totals.projects}</div>
              </div>
              <div>
                <div className="text-muted small">Segments</div>
                <div className="h5 mb-0">{usageSummary.totals.segments}</div>
              </div>
              <div>
                <div className="text-muted small">Under review</div>
                <div className="h5 mb-0">{usageSummary.totals.underReview}</div>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr className="text-muted small">
                    <th>User</th>
                    <th>Projects</th>
                    <th>Segments</th>
                    <th>Under review</th>
                  </tr>
                </thead>
                <tbody>
                  {usageSummary.users.map((entry) => (
                    <tr key={entry.userId}>
                      <td>{formatActorLabel(entry.userId, userLabelMap)}</td>
                      <td>{entry.projects}</td>
                      <td>{entry.segments}</td>
                      <td>{entry.underReview}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {chatUsageSummary ? (
              <div className="mt-4 pt-3 border-top">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="mb-0">Assistant chat usage</h6>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleDownloadChatUsage}
                    disabled={downloadingChat}
                  >
                    {downloadingChat ? "Downloading..." : "Download Chat CSV"}
                  </button>
                </div>
                <div className="d-flex gap-4 flex-wrap mb-3">
                  <div>
                    <div className="text-muted small">Requests</div>
                    <div className="h5 mb-0">{chatUsageSummary.totals.requests}</div>
                  </div>
                  <div>
                    <div className="text-muted small">Request failures</div>
                    <div className="h5 mb-0">{chatUsageSummary.totals.requestFailures}</div>
                  </div>
                  <div>
                    <div className="text-muted small">Messages</div>
                    <div className="h5 mb-0">{chatUsageSummary.totals.messages}</div>
                  </div>
                  <div>
                    <div className="text-muted small">Tool calls</div>
                    <div className="h5 mb-0">{chatUsageSummary.totals.toolCalls}</div>
                  </div>
                </div>
                <div className="table-responsive mb-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr className="text-muted small">
                        <th>User</th>
                        <th>Threads</th>
                        <th>User messages</th>
                        <th>Assistant messages</th>
                        <th>Tool calls</th>
                        <th>Failures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chatUsageSummary.users.map((entry) => (
                        <tr key={entry.userId}>
                          <td>{formatActorLabel(String(entry.userId), userLabelMap)}</td>
                          <td>{entry.threads}</td>
                          <td>{entry.userMessages}</td>
                          <td>{entry.assistantMessages}</td>
                          <td>{entry.toolCalls}</td>
                          <td>{entry.failures}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr className="text-muted small">
                        <th>Tool</th>
                        <th>Calls</th>
                        <th>Failures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chatUsageSummary.tools.map((entry) => (
                        <tr key={entry.toolName}>
                          <td>{entry.toolName}</td>
                          <td>{entry.calls}</td>
                          <td>{entry.failures}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                    <h6 className="mb-0">Chat audit events</h6>
                    <div className="d-flex align-items-center gap-2">
                      <select
                        className="form-select form-select-sm"
                        value={chatAuditEventType}
                        onChange={(event) => setChatAuditEventType(event.target.value)}
                        aria-label="Filter chat audit event type"
                      >
                        {chatAuditOptions.map((option) => (
                          <option key={option || "all"} value={option}>
                            {option || "all events"}
                          </option>
                        ))}
                      </select>
                      <select
                        className="form-select form-select-sm"
                        value={chatAuditLimit}
                        onChange={(event) => setChatAuditLimit(Number(event.target.value))}
                        aria-label="Chat audit row limit"
                      >
                        {[25, 50, 100, 200].map((limit) => (
                          <option key={limit} value={limit}>
                            {limit} rows
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={loadChatAuditEvents}
                        disabled={chatAuditLoading}
                      >
                        {chatAuditLoading ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr className="text-muted small">
                          <th>When</th>
                          <th>User</th>
                          <th>Event</th>
                          <th>Tool</th>
                          <th>Request</th>
                          <th>Thread</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chatAuditEvents.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-muted">
                              No chat audit events.
                            </td>
                          </tr>
                        ) : (
                          chatAuditEvents.map((event) => (
                            <tr key={event.id}>
                              <td>{new Date(event.createdAt).toLocaleString()}</td>
                              <td>{formatActorLabel(String(event.userId), userLabelMap)}</td>
                              <td>{event.eventType}</td>
                              <td>{event.toolName || "-"}</td>
                              <td className="font-monospace small">{event.requestId.slice(0, 8)}</td>
                              <td>{event.threadId ?? "-"}</td>
                              <td>{event.messageId ?? "-"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
