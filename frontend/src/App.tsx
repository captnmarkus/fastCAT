import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { getSetupStatus, logout, me } from "./api";
import Login from "./Login";
import Shell from "./components/Shell";
import ErrorBoundary from "./components/ErrorBoundary";
import { GLOBAL_STYLES } from "./config/theme";
import ChangePassword from "./routes/ChangePassword";
import SettingsShell from "./routes/settings/SettingsShell";
import ManageAccountTab from "./routes/settings/tabs/ManageAccountTab";
import UserManagementTab from "./routes/settings/tabs/UserManagementTab";
import StatsTab from "./routes/settings/tabs/StatsTab";
import DashboardPage from "./routes/DashboardPage";
import InboxMainPage from "./routes/inbox/main/InboxMainPage";
import AdminUsersPage from "./routes/AdminUsersPage";
import AdminStatsPage from "./routes/AdminStatsPage";
import AdminLanguagesPage from "./routes/AdminLanguagesPage";
import AdminDepartmentsPage from "./routes/AdminDepartmentsPage";
import AdminAppAgentPage from "./routes/AdminAppAgentPage";
import SetupWizardPage from "./routes/SetupWizardPage";
import ProjectsMainPage from "./routes/projects/main/ProjectsMainPage";
import ProjectsCreatePage from "./routes/projects/create/ProjectsCreatePage";
import ProjectsDetailsPage from "./routes/projects/details/ProjectsDetailsPage";
import ProjectProvisioningPage from "./routes/projects/provisioning/ProjectProvisioningPage";
import EditorFilePage from "./routes/editor/file/EditorFilePage";
import ResourcesShell from "./routes/resources/ResourcesShell";
import ProjectTemplatesPage from "./routes/resources/project-templates/ProjectTemplatesPage";
import ProjectTemplateDetailsPage from "./routes/resources/project-templates/ProjectTemplateDetailsPage";
import ProjectTemplateWizardPage from "./routes/resources/project-templates/ProjectTemplateWizardPage";
import FileTypesPage from "./routes/resources/file-types/FileTypesPage";
import FileTypeConfigWizardPage from "./routes/resources/file-types/FileTypeConfigWizardPage";
import JsonTemplatesPage from "./routes/resources/json-templates/JsonTemplatesPage";
import TranslationEnginesPage from "./routes/resources/translation-engines/TranslationEnginesPage";
import TranslationEngineWizardPage from "./routes/resources/translation-engines/TranslationEngineWizardPage";
import TranslationMemoriesPage from "./routes/resources/translation-memories/TranslationMemoriesPage";
import TranslationMemoryDetailsPage from "./routes/resources/translation-memories/TranslationMemoryDetailsPage";
import TranslationMemoryWizardPage from "./routes/resources/translation-memories/TranslationMemoryWizardPage";
import TerminologyPage from "./routes/resources/terminology/TerminologyPage";
import TermbaseEditorPage from "./routes/resources/terminology/TermbaseEditorPage";
import TermbaseExportPage from "./routes/resources/terminology/TermbaseExportPage";
import TermbaseImportPage from "./routes/resources/terminology/TermbaseImportPage";
import TermbaseShellPage from "./routes/resources/terminology/TermbaseShellPage";
import TermbaseStructurePage from "./routes/resources/terminology/TermbaseStructurePage";
import TermbaseWizardPage from "./routes/resources/terminology/TermbaseWizardPage";
import RulesListPage from "./routes/resources/rules/RulesListPage";
import RulesetDetailsPage from "./routes/resources/rules/RulesetDetailsPage";
import RulesetWizardPage from "./routes/resources/rules/RulesetWizardPage";
import NmtProvidersPage from "./routes/resources/nmt-providers/NmtProvidersPage";
import NmtProviderWizardPage from "./routes/resources/nmt-providers/NmtProviderWizardPage";
import type { AuthUser } from "./types/app";
import { TableDensityProvider } from "./components/ui/TableDensity";

export default function App() {
  const [setupStatus, setSetupStatus] = useState<"checking" | "configured" | "not_configured" | "error">("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const densityStorageScope = user ? String(user.username || user.id || "").trim() : "guest";

  useEffect(() => {
    (async () => {
      try {
        const status = await getSetupStatus();
        setSetupStatus(status.status === "configured" ? "configured" : "not_configured");
      } catch {
        setSetupStatus("error");
      }
    })();
  }, []);

  useEffect(() => {
    if (setupStatus !== "configured") {
      setUser(null);
      setChecking(false);
      return;
    }
    if (user) {
      setChecking(false);
      return;
    }
    (async () => {
      setChecking(true);
      try {
        const current = await me();
        setUser(current);
      } catch {
        setUser(null);
      } finally {
        setChecking(false);
      }
    })();
  }, [setupStatus, user]);

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  function handleSetupComplete(nextUser?: AuthUser | null) {
    setSetupStatus("configured");
    setUser(nextUser ?? null);
    setChecking(false);
  }

  if (setupStatus === "checking") {
    return (
      <TableDensityProvider storageScope={densityStorageScope}>
        <style>{GLOBAL_STYLES}</style>
        <LoadingScreen />
      </TableDensityProvider>
    );
  }

  if (setupStatus === "error") {
    return (
      <TableDensityProvider storageScope={densityStorageScope}>
        <style>{GLOBAL_STYLES}</style>
        <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
          <div className="card shadow-sm border-0" style={{ width: 420, maxWidth: "100%" }}>
            <div className="card-body text-center">
              <h5 className="mb-2">Setup status unavailable</h5>
              <p className="text-muted small mb-3">
                FastCAT could not verify whether Global Setup is complete. Please check the API service and retry.
              </p>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </TableDensityProvider>
    );
  }

  if (setupStatus === "not_configured") {
    return (
      <TableDensityProvider storageScope={densityStorageScope}>
        <BrowserRouter>
          <style>{GLOBAL_STYLES}</style>
          <Routes>
            <Route
              path="/setup"
              element={<SetupWizardPage onConfigured={handleSetupComplete} />}
            />
            <Route path="*" element={<Navigate to="/setup" replace />} />
          </Routes>
        </BrowserRouter>
      </TableDensityProvider>
    );
  }

  return (
    <TableDensityProvider storageScope={densityStorageScope}>
      <BrowserRouter>
        <style>{GLOBAL_STYLES}</style>
        <Routes>
        <Route
          path="/"
          element={<Navigate to="/dashboard" replace />}
        />
        <Route
          path="/projects"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <ProjectsMainPage currentUser={user as AuthUser} />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/projects/create"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <ProjectsCreatePage currentUser={user as AuthUser} />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <ProjectsDetailsPage currentUser={user as AuthUser} />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id/provisioning"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <ProjectProvisioningPage />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <DashboardPage currentUser={user} />
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/inbox"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <ErrorBoundary title="Inbox failed to render">
                  <InboxMainPage currentUser={user} />
                </ErrorBoundary>
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/inbox/:projectId/files/:fileId"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <LegacyEditorRedirect />
            </RequireAuth>
          }
        />
        <Route
          path="/editor/:taskId"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <ErrorBoundary title="Editor failed to render">
                <EditorFilePage currentUser={user} />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/glossary"
          element={<Navigate to="/resources/terminology" replace />}
        />
        <Route
          path="/resources"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <RequireRole user={user as AuthUser} allow={["admin", "manager"]}>
                  <ResourcesShell />
                </RequireRole>
              </Shell>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/resources/templates" replace />} />
          <Route path="project-templates" element={<Navigate to="/resources/templates" replace />} />
          <Route path="templates" element={<ProjectTemplatesPage currentUser={user as AuthUser} />} />
          <Route path="templates/new" element={<ProjectTemplateWizardPage currentUser={user as AuthUser} />} />
          <Route path="templates/:id" element={<ProjectTemplateDetailsPage currentUser={user as AuthUser} />} />
          <Route path="templates/:id/edit" element={<ProjectTemplateWizardPage currentUser={user as AuthUser} />} />
          <Route path="file-types" element={<FileTypesPage currentUser={user as AuthUser} />} />
          <Route path="json-templates" element={<JsonTemplatesPage currentUser={user as AuthUser} />} />
          <Route path="extraction-templates" element={<Navigate to="/resources/json-templates" replace />} />
          <Route path="file-types/create" element={<FileTypeConfigWizardPage currentUser={user as AuthUser} />} />
          <Route path="file-types/:id" element={<FileTypeConfigWizardPage currentUser={user as AuthUser} />} />
          <Route path="translation-engines" element={<TranslationEnginesPage currentUser={user as AuthUser} />} />
          <Route path="translation-engines/create" element={<TranslationEngineWizardPage currentUser={user as AuthUser} />} />
          <Route path="translation-memories" element={<TranslationMemoriesPage currentUser={user as AuthUser} />} />
          <Route path="translation-memories/new" element={<TranslationMemoryWizardPage currentUser={user as AuthUser} />} />
          <Route path="translation-memories/:id" element={<TranslationMemoryDetailsPage currentUser={user as AuthUser} />} />
          <Route path="tm/new" element={<TranslationMemoryWizardPage currentUser={user as AuthUser} />} />
          <Route path="tm/:id" element={<TranslationMemoryDetailsPage currentUser={user as AuthUser} />} />
          <Route path="terminology" element={<TerminologyPage currentUser={user as AuthUser} />} />
          <Route path="terminology/create" element={<TermbaseWizardPage />} />
          <Route path="termbases/:termbaseId" element={<TermbaseShellPage currentUser={user as AuthUser} />}>
            <Route index element={<Navigate to="entries" replace />} />
            <Route path="entries" element={<TermbaseEditorPage />} />
            <Route path="import" element={<TermbaseImportPage />} />
            <Route path="export" element={<TermbaseExportPage />} />
            <Route path="structure" element={<TermbaseStructurePage />} />
          </Route>
          <Route path="language-processing-rules" element={<Navigate to="/resources/rules" replace />} />
          <Route path="rules" element={<RulesListPage currentUser={user as AuthUser} />} />
          <Route path="rules/new" element={<RulesetWizardPage currentUser={user as AuthUser} />} />
          <Route path="rules/:id" element={<RulesetDetailsPage currentUser={user as AuthUser} />} />
          <Route path="rules/:id/edit" element={<RulesetWizardPage currentUser={user as AuthUser} />} />
          <Route path="nmt-providers" element={<NmtProvidersPage currentUser={user as AuthUser} />} />
          <Route path="nmt-providers/create" element={<NmtProviderWizardPage currentUser={user as AuthUser} />} />
          <Route path="nmt-models" element={<Navigate to="/resources/nmt-providers" replace />} />
        </Route>
        <Route
          path="/admin/users"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <RequireRole user={user as AuthUser} allow={["admin"]}>
                  <AdminUsersPage currentUser={user as AuthUser} />
                </RequireRole>
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/stats"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <RequireRole user={user as AuthUser} allow={["admin"]}>
                  <AdminStatsPage currentUser={user as AuthUser} />
                </RequireRole>
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/languages"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <RequireRole user={user as AuthUser} allow={["admin"]}>
                  <AdminLanguagesPage currentUser={user as AuthUser} />
                </RequireRole>
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/departments"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <RequireRole user={user as AuthUser} allow={["admin"]}>
                  <AdminDepartmentsPage currentUser={user as AuthUser} />
                </RequireRole>
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/app-agent"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <RequireRole user={user as AuthUser} allow={["admin"]}>
                  <AdminAppAgentPage currentUser={user as AuthUser} />
                </RequireRole>
              </Shell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={<Navigate to="/settings" replace />}
        />
        <Route
          path="/settings"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <SettingsShell currentUser={user as AuthUser} />
              </Shell>
            </RequireAuth>
          }
        >
          <Route index element={<SettingsIndexRedirect />} />
          <Route
            path="account"
            element={
              <ManageAccountTab
                currentUser={user as AuthUser}
                onUserUpdated={(u) => setUser(u)}
              />
            }
          />
          <Route
            path="users"
            element={
              <RequireRole user={user as AuthUser} allow={["admin"]}>
                <UserManagementTab currentUser={user as AuthUser} />
              </RequireRole>
            }
          />
          <Route
            path="stats"
            element={
              <RequireRole user={user as AuthUser} allow={["admin"]}>
                <StatsTab currentUser={user as AuthUser} />
              </RequireRole>
            }
          />
          <Route
            path="templates"
            element={
              <Navigate to="/resources/file-types" replace />
            }
          />
        </Route>
        <Route
          path="/change-password"
          element={
            <RequireAuth
              user={user}
              checking={checking}
              onSignedIn={(u) => setUser(u)}
            >
              <Shell user={user} onLogout={handleLogout}>
                <ChangePassword
                  currentUser={user as AuthUser}
                  onUpdated={(u) => setUser(u)}
                />
              </Shell>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </TableDensityProvider>
  );
}

function LegacyEditorRedirect() {
  const params = useParams<{ fileId: string }>();
  const fileId = Number(params.fileId);
  if (!Number.isFinite(fileId) || fileId <= 0) {
    return (
      <div className="alert alert-warning m-3">
        Invalid file link.
      </div>
    );
  }
  return (
    <div className="alert alert-warning m-3">
      This link points to a legacy file. Open the task from the Inbox to continue.
    </div>
  );
}

function RequireAuth({
  user,
  checking,
  onSignedIn,
  children
}: {
  user: AuthUser | null;
  checking: boolean;
  onSignedIn: (user: AuthUser) => void;
  children: React.ReactNode;
}) {
  const location = useLocation();
  if (checking) {
    return <LoadingScreen />;
  }
  if (!user) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
        <div style={{ width: "360px", maxWidth: "100%" }}>
          <Login onSuccess={onSignedIn} />
        </div>
      </div>
    );
  }
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="d-flex align-items-center justify-content-center py-5">
      <span className="spinner-border text-dark me-2" />
      <span>Loading FastCAT...</span>
    </div>
  );
}

function RequireRole({
  user,
  allow,
  children
}: {
  user: AuthUser | null;
  allow: string[];
  children: React.ReactNode;
}) {
  if (!user) return null;
  if (!allow.includes(user.role)) {
    return (
      <div className="alert alert-warning">
        You do not have permission to view this page.
      </div>
    );
  }
  return <>{children}</>;
}

function SettingsIndexRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requested = (params.get("tab") || params.get("view") || "").toLowerCase();

  if (requested === "users") return <Navigate to="users" replace />;
  if (requested === "usage" || requested === "stats") return <Navigate to="stats" replace />;
  if (requested === "app-agent" || requested === "agent") return <Navigate to="/admin/app-agent" replace />;
  if (requested === "parsing" || requested === "templates") return <Navigate to="/resources/file-types" replace />;
  if (requested === "glossary") return <Navigate to="/glossary" replace />;
  if (requested === "tm") return <Navigate to="/resources" replace />;

  return <Navigate to="account" replace />;
}
