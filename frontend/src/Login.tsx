import { FormEvent, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
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

  const content = (
    <Stack spacing={2.25}>
        {!compact && (
        <Box sx={{ textAlign: "center" }}>
            <img
              className="fc-login-logo"
              src="/logos/fastcat_logo.png"
              alt="FastCAT"
            />
          <Typography variant="h5" component="h1" sx={{ mt: 1, fontSize: "1.1rem" }}>
            Sign in to FastCAT
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Translation workspace
          </Typography>
        </Box>
        )}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        <TextField
              label="Username"
              value={username}
              autoComplete="username"
              autoFocus
              disabled={loading}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
          fullWidth
            />
        <TextField
              type="password"
          label="Password"
              value={password}
              autoComplete="current-password"
              disabled={loading}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
          fullWidth
            />
        <Button
            type="submit"
          variant="contained"
          color="primary"
            disabled={loading}
          fullWidth
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            Sign in
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
          Admins can create team members inside the workspace.
        </Typography>
      </Stack>
    </Stack>
  );

  if (compact) {
    return <Box>{content}</Box>;
  }

  return (
    <Card className="fc-login-card" elevation={0}>
      <CardContent sx={{ p: { xs: 2.5, sm: 3 }, "&:last-child": { pb: { xs: 2.5, sm: 3 } } }}>
        {content}
      </CardContent>
    </Card>
  );
}
