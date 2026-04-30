import { createTheme } from "@mui/material/styles";

export const fastCatMuiTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#111827",
      light: "#374151",
      dark: "#030712",
      contrastText: "#ffffff"
    },
    secondary: {
      main: "#0f766e",
      light: "#14b8a6",
      dark: "#115e59",
      contrastText: "#ffffff"
    },
    info: {
      main: "#2563eb"
    },
    success: {
      main: "#2e7d32"
    },
    warning: {
      main: "#b7791f"
    },
    error: {
      main: "#b42318"
    },
    background: {
      default: "#f8f9fb",
      paper: "#ffffff"
    },
    text: {
      primary: "#111827",
      secondary: "rgba(17, 24, 39, 0.68)"
    },
    divider: "rgba(17, 24, 39, 0.1)"
  },
  shape: {
    borderRadius: 8
  },
  typography: {
    fontFamily: '"Suisse Intl", "IBM Plex Sans", "Manrope", "Segoe UI", sans-serif',
    button: {
      fontWeight: 700,
      letterSpacing: 0,
      textTransform: "none"
    },
    h1: {
      letterSpacing: 0,
      fontWeight: 800
    },
    h2: {
      letterSpacing: 0,
      fontWeight: 750
    },
    h3: {
      letterSpacing: 0,
      fontWeight: 720
    },
    h4: {
      letterSpacing: 0,
      fontWeight: 700
    },
    h5: {
      letterSpacing: 0,
      fontWeight: 700
    },
    h6: {
      letterSpacing: 0,
      fontWeight: 700
    }
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true
      },
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: 8
        },
        sizeSmall: {
          minHeight: 32,
          borderRadius: 6
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          border: "1px solid rgba(17, 24, 39, 0.1)",
          boxShadow: "0 1px 2px rgba(16, 24, 40, 0.06)"
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 8
        }
      }
    },
    MuiTextField: {
      defaultProps: {
        size: "small"
      }
    },
    MuiFormControl: {
      defaultProps: {
        size: "small"
      }
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8
        }
      }
    }
  }
});
