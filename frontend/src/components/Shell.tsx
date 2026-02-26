import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { AuthUser } from "../types/app";
import { listInboxItems, type InboxItem } from "../api";
import { safeLocalStorageGet, safeLocalStorageSet } from "../routes/projects/shared/storage";


type ShellProps = {
  children: React.ReactNode;
  user: AuthUser | null;
  onLogout: () => Promise<void>;
};

type ShellSecondaryNavContextValue = {
  setSecondaryNav: (node: React.ReactNode | null) => void;
};

const ShellSecondaryNavContext = React.createContext<ShellSecondaryNavContextValue | null>(null);

export function useShellSecondaryNav() {
  const ctx = React.useContext(ShellSecondaryNavContext);
  if (!ctx) {
    throw new Error("useShellSecondaryNav must be used within <Shell />");
  }
  return ctx;
}

export default function Shell({ children, user, onLogout }: ShellProps) {
  const [adminBarOpen, setAdminBarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement | null>(null);
  const bellButtonRef = useRef<HTMLButtonElement | null>(null);
  const adminBarRef = useRef<HTMLElement | null>(null);
  const bellPanelRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isAccountArea =
    location.pathname.startsWith("/settings/account") ||
    location.pathname.startsWith("/admin") ||
    location.pathname === "/change-password";
  const wasAccountAreaRef = useRef(isAccountArea);
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "manager";
  const canAccessOrgTools = isAdmin || isManager;
  const [secondaryNav, setSecondaryNav] = useState<React.ReactNode | null>(null);
  const secondaryNavApi = useMemo(() => ({ setSecondaryNav }), []);

  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const currentUserKey = useMemo(() => {
    const id = user ? String(user.id) : "";
    const username = user?.username ? String(user.username) : "";
    return (username || id).trim();
  }, [user?.id, user?.username]);

  const bellSeenStorageKey = useMemo(() => {
    return currentUserKey ? `fc:${currentUserKey}:bellSeenAt` : "fc:bellSeenAt";
  }, [currentUserKey]);
  const avatarStorageKey = useMemo(() => {
    return currentUserKey ? `fc:${currentUserKey}:avatar` : "fc:avatar";
  }, [currentUserKey]);

  const [bellSeenAtMs, setBellSeenAtMs] = useState<number>(0);
  const [avatarImageUrl, setAvatarImageUrl] = useState<string | null>(null);

  const avatarRoleClass = useMemo(() => {
    const role = String(user?.role || "").toLowerCase();
    if (role === "admin") return "role-admin";
    if (role === "manager") return "role-manager";
    return "role-reviewer";
  }, [user?.role]);

  const avatarLabel = useMemo(() => {
    const name = String(user?.displayName || user?.username || "").trim();
    if (!name) return "Account actions";
    return `Account actions for ${name}`;
  }, [user?.displayName, user?.username]);

  const avatarInitials = useMemo(() => {
    const name = String(user?.displayName || user?.username || "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return String(parts[0][0] || "U").toUpperCase();
    const first = String(parts[0][0] || "");
    const last = String(parts[parts.length - 1][0] || "");
    return `${first}${last}`.toUpperCase() || "U";
  }, [user?.displayName, user?.username]);

  const pendingInboxItems = useMemo(() => {
    return inboxItems.filter((item) => {
      const status = String(item.status || "").toLowerCase();
      return status !== "reviewed" && status !== "approved";
    });
  }, [inboxItems]);

  const pendingCount = pendingInboxItems.length;
  const bellPreviewItems = pendingInboxItems.slice(0, 8);

  const bellUnseenCount = useMemo(() => {
    if (pendingInboxItems.length === 0) return 0;
    if (!bellSeenAtMs) return pendingInboxItems.length;
    let count = 0;
    for (const item of pendingInboxItems) {
      const createdMs = new Date(item.createdAt).getTime();
      if (Number.isFinite(createdMs) && createdMs > bellSeenAtMs) count += 1;
    }
    return count;
  }, [bellSeenAtMs, pendingInboxItems]);

  async function refreshInboxSummary() {
    if (!user) return;
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    setInboxError(null);
    try {
      const list = await listInboxItems();
      setInboxItems(list);
    } catch (err: any) {
      setInboxError(err?.message || "Failed to load inbox");
    } finally {
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refreshInboxSummary();
      }
    }
  }

  function scheduleInboxRefresh(delayMs = 350) {
    if (!user) return;
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshInboxSummary();
    }, delayMs);
  }

  useEffect(() => {
    if (!user) return;
    void refreshInboxSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setBellSeenAtMs(0);
      return;
    }
    const raw = safeLocalStorageGet(bellSeenStorageKey);
    const parsed = raw != null ? Number(raw) : 0;
    setBellSeenAtMs(Number.isFinite(parsed) ? parsed : 0);
  }, [bellSeenStorageKey, user?.id]);

  useEffect(() => {
    if (!user) {
      setAvatarImageUrl(null);
      return;
    }
    const next = safeLocalStorageGet(avatarStorageKey);
    if (next && next.startsWith("data:image/")) {
      setAvatarImageUrl(next);
      return;
    }
    setAvatarImageUrl(null);
  }, [avatarStorageKey, user?.id]);

  useEffect(() => {
    function handleAvatarRefresh(event: Event) {
      const customEvent = event as CustomEvent<{ key?: string }>;
      const key = String(customEvent.detail?.key || "").trim();
      if (key && key !== avatarStorageKey) return;
      const next = safeLocalStorageGet(avatarStorageKey);
      if (next && next.startsWith("data:image/")) {
        setAvatarImageUrl(next);
        return;
      }
      setAvatarImageUrl(null);
    }
    window.addEventListener("fc:avatar:updated", handleAvatarRefresh as EventListener);
    return () => {
      window.removeEventListener("fc:avatar:updated", handleAvatarRefresh as EventListener);
    };
  }, [avatarStorageKey]);

  useEffect(() => {
    if (!bellOpen || !user) return;
    const now = Date.now();
    setBellSeenAtMs(now);
    safeLocalStorageSet(bellSeenStorageKey, String(now));
  }, [bellOpen, bellSeenStorageKey, user]);

  useEffect(() => {
    function handleRefreshEvent() {
      scheduleInboxRefresh();
    }
    window.addEventListener("fc:inbox:refresh", handleRefreshEvent as EventListener);
    return () => {
      window.removeEventListener("fc:inbox:refresh", handleRefreshEvent as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setBellOpen(false);
        setAdminBarOpen(false);
      }
    }

    if (!adminBarOpen && !bellOpen) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [adminBarOpen, bellOpen]);

  useEffect(() => {
    if (!bellOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (bellButtonRef.current?.contains(target)) return;
      if (bellPanelRef.current?.contains(target)) return;
      setBellOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [bellOpen]);

  useEffect(() => {
    if (adminBarOpen && wasAccountAreaRef.current && !isAccountArea) {
      setAdminBarOpen(false);
    }
    wasAccountAreaRef.current = isAccountArea;
  }, [adminBarOpen, isAccountArea]);

  function toggleAccountBar() {
    setBellOpen(false);
    if (adminBarOpen) {
      setAdminBarOpen(false);
      return;
    }
    setAdminBarOpen(true);
    if (location.pathname !== "/settings/account") {
      navigate("/settings/account");
    }
  }

  function toggleBell() {
    setAdminBarOpen(false);
    setBellOpen((prev) => {
      const next = !prev;
      if (next) scheduleInboxRefresh(0);
      return next;
    });
  }

  function closeOverlays() {
    setAdminBarOpen(false);
    setBellOpen(false);
  }

  function handleLogout() {
    closeOverlays();
    void onLogout();
  }

  function linkClass(base: string) {
    return ({ isActive }: { isActive: boolean }) => `${base}${isActive ? " active" : ""}`;
  }

  if (!user) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <span className="spinner-border text-dark" />
      </div>
    );
  }

  return (
    <ShellSecondaryNavContext.Provider value={secondaryNavApi}>
      <div className="vh-100 d-flex flex-column">
        <header className="fc-topbar sticky-top">
          <div
            className="container-fluid d-flex align-items-center justify-content-between px-3"
            style={{ height: "var(--fc-topbar-height)" }}
          >
            <div className="d-flex align-items-center gap-4">
              <Link
                className="fc-brand-link text-decoration-none d-flex align-items-center gap-2"
                to="/dashboard"
                onMouseDownCapture={closeOverlays}
              >
                <img
                  src="/logos/fastcat_logo.png"
                  alt="FastCAT"
                  style={{ height: 34, width: "auto" }}
                />
                <span className="fastcat-brand" aria-hidden="true">
                  <span className="fastcat-brand-fast">fast</span>
                  <span className="fastcat-brand-cat">CAT</span>
                </span>
              </Link>
              <nav
                className="d-flex align-items-center gap-1 fc-topnav ms-2"
                aria-label="Primary navigation"
                onMouseDownCapture={closeOverlays}
              >
                <NavLink className={linkClass("nav-link fc-topnav-link")} to="/dashboard">
                  Dashboard
                </NavLink>
                <NavLink className={linkClass("nav-link fc-topnav-link")} to="/inbox">
                  <span className="d-inline-flex align-items-center gap-2">
                    Inbox
                    {pendingCount > 0 && (
                      <span className="badge fc-count-badge" aria-label={`${pendingCount} items pending`}>
                        {pendingCount}
                      </span>
                    )}
                  </span>
                </NavLink>
                <NavLink className={linkClass("nav-link fc-topnav-link")} to="/projects">
                  Projects
                </NavLink>
                {canAccessOrgTools && (
                  <NavLink className={linkClass("nav-link fc-topnav-link")} to="/resources">
                    Resources
                  </NavLink>
                )}
              </nav>
            </div>
            <div className="d-flex align-items-center gap-2">
              <div className="position-relative">
                <button
                  ref={bellButtonRef}
                  type="button"
                  className={`btn fc-bell-button${bellOpen ? " active" : ""}`}
                  onClick={toggleBell}
                  aria-label={
                    bellUnseenCount > 0 ? `Notifications (${bellUnseenCount} unseen)` : "Notifications"
                  }
                  aria-controls="fc-notifications"
                  aria-expanded={bellOpen}
                >
                  <i className="bi bi-bell" aria-hidden="true" />
                  {bellUnseenCount > 0 && (
                    <span className="badge fc-count-badge fc-count-badge-dot" aria-hidden="true">
                      {bellUnseenCount}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <div
                    ref={bellPanelRef}
                    id="fc-notifications"
                    className="fc-bell-panel card-enterprise"
                    role="dialog"
                    aria-label="Pending work"
                  >
                    <div className="fc-bell-panel-header d-flex align-items-center justify-content-between">
                      <div className="fw-semibold">To do</div>
                      <div className="text-muted small">{pendingCount ? `${pendingCount} pending` : "Nothing to do"}</div>
                    </div>

                    <div className="fc-bell-panel-body">
                      {inboxError ? (
                        <div className="text-danger small">{inboxError}</div>
                      ) : bellPreviewItems.length === 0 ? (
                        <div className="text-muted small">Nothing to do.</div>
                      ) : (
                        <div className="d-flex flex-column">
                          {bellPreviewItems.map((item) => (
                            <button
                              key={`${item.projectId}:${item.taskId}`}
                              type="button"
                              className="fc-bell-item"
                              onClick={() => {
                                setBellOpen(false);
                                navigate(`/editor/${item.taskId}`);
                              }}
                            >
                              <div className="d-flex align-items-start justify-content-between gap-2">
                                <div style={{ minWidth: 0 }}>
                                  <div className="fc-bell-item-title text-truncate">{item.projectName}</div>
                                  <div className="fc-bell-item-sub text-truncate">
                                    {item.originalFilename} - {String(item.srcLang).toUpperCase()} to {String(item.tgtLang).toUpperCase()}
                                  </div>
                                </div>
                                <span className="badge fc-bell-status">{String(item.status).replace(/_/g, " ").toUpperCase()}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="fc-bell-panel-footer d-flex justify-content-end">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none"
                        onClick={() => {
                          setBellOpen(false);
                          navigate("/inbox");
                        }}
                      >
                        View all
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-end d-flex flex-column align-items-end">
                <div className="fw-semibold lh-sm d-none d-md-block">
                  {user?.displayName || user?.username || "user"}
                </div>
              </div>
              <button
                ref={avatarRef}
                className={`btn fc-avatar-button ${avatarRoleClass}${adminBarOpen ? " active" : ""}`}
                type="button"
                onClick={toggleAccountBar}
                aria-label={avatarLabel}
                aria-controls="fc-accountbar"
                aria-expanded={adminBarOpen}
              >
                {avatarImageUrl ? (
                  <img className="fc-avatar-image" src={avatarImageUrl} alt="" aria-hidden="true" />
                ) : (
                  <span className="fc-avatar-initials" aria-hidden="true">
                    {avatarInitials}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        <nav
          ref={adminBarRef}
          id="fc-accountbar"
          className={`fc-adminbar ${adminBarOpen ? "open" : ""}`.trim()}
          aria-label="Account actions"
          aria-hidden={!adminBarOpen}
        >
          <div
            className="container-fluid px-3 d-flex align-items-center justify-content-end"
            style={{ height: "var(--fc-adminbar-height)" }}
          >
            <ul className="nav fc-adminbar-nav ms-auto">
              <li className="nav-item">
                <NavLink className={linkClass("nav-link fc-topnav-link")} to="/settings/account" tabIndex={adminBarOpen ? 0 : -1}>
                  Manage account
                </NavLink>
              </li>
              {isAdmin && (
                <li className="nav-item">
                  <NavLink className={linkClass("nav-link fc-topnav-link")} to="/admin/users" tabIndex={adminBarOpen ? 0 : -1}>
                    User management
                  </NavLink>
                </li>
              )}
              {isAdmin && (
                <li className="nav-item">
                  <NavLink className={linkClass("nav-link fc-topnav-link")} to="/admin/stats" tabIndex={adminBarOpen ? 0 : -1}>
                    Stats
                  </NavLink>
                </li>
              )}
              {isAdmin && (
                <li className="nav-item">
                  <NavLink className={linkClass("nav-link fc-topnav-link")} to="/admin/languages" tabIndex={adminBarOpen ? 0 : -1}>
                    Language settings
                  </NavLink>
                </li>
              )}
              {isAdmin && (
                <li className="nav-item">
                  <NavLink className={linkClass("nav-link fc-topnav-link")} to="/admin/departments" tabIndex={adminBarOpen ? 0 : -1}>
                    Departments
                  </NavLink>
                </li>
              )}
              {isAdmin && (
                <li className="nav-item">
                  <NavLink className={linkClass("nav-link fc-topnav-link")} to="/admin/app-agent" tabIndex={adminBarOpen ? 0 : -1}>
                    App Agent
                  </NavLink>
                </li>
              )}
              <li className="nav-item fc-adminbar-separator" aria-hidden="true" />
              <li className="nav-item">
                <button
                  type="button"
                  className="nav-link fc-topnav-link fc-accountbar-logout"
                  onClick={handleLogout}
                  tabIndex={adminBarOpen ? 0 : -1}
                >
                  <i className="bi bi-box-arrow-right" aria-hidden="true" />
                  <span>Logout</span>
                </button>
              </li>
            </ul>
          </div>
        </nav>

        {secondaryNav && (
          <nav className="fc-subnav">
            <div
              className="container-fluid px-3 d-flex align-items-center"
              style={{ height: "var(--fc-subnav-height)" }}
            >
              {secondaryNav}
            </div>
          </nav>
        )}

        <main
          className="container-fluid flex-grow-1 px-3 py-0 overflow-auto"
          style={{ minHeight: 0 }}
        >
          {children}
        </main>
      </div>
    </ShellSecondaryNavContext.Provider>
  );
}
