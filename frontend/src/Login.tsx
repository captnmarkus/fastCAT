import { FormEvent, useState } from "react";
import { login } from "./api";

type Props = {
  onSuccess?: (user: any) => void;
  compact?: boolean;
};

export default function Login({ onSuccess, compact }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter username and password.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      if (onSuccess) {
        onSuccess(user);
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("Wrong username or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "" : "card shadow-sm border-0"}>
      <div className={compact ? "" : "card-body"}>
        {!compact && (
          <div className="text-center mb-3">
            <img
              src="/logos/fastcat_logo.png"
              alt="FastCAT"
              style={{ height: 56, width: "auto" }}
            />
            <h5 className="card-title mt-2 mb-0">Sign in to FastCAT</h5>
            <div className="text-muted small">Translation workspace</div>
          </div>
        )}
        {error && <div className="alert alert-danger py-1 mb-3">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label className="form-label small text-uppercase text-muted">
              Username
            </label>
            <input
              className="form-control"
              value={username}
              autoComplete="username"
              autoFocus
              disabled={loading}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>
          <div className="mb-3">
            <label className="form-label small text-uppercase text-muted">
              Password
            </label>
            <input
              type="password"
              className="form-control"
              value={password}
              autoComplete="current-password"
              disabled={loading}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary w-100"
            disabled={loading}
          >
            {loading && (
              <span className="spinner-border spinner-border-sm me-2" />
            )}
            Sign in
          </button>
          <div className="form-text mt-2 text-center">
            Admins can create team members inside the workspace.
          </div>
        </form>
      </div>
    </div>
  );
}
