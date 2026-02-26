import React from "react";

type Props = {
  title?: string;
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage: string | null;
  resetKey: number;
};

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    errorMessage: null,
    resetKey: 0
  };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("UI error boundary caught:", error);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      errorMessage: null,
      resetKey: prev.resetKey + 1
    }));
  };

  render() {
    const title = this.props.title || "Something went wrong";
    if (this.state.hasError) {
      return (
        <div className="p-3">
          <div className="alert alert-danger">
            <div className="fw-semibold">{title}</div>
            {this.state.errorMessage ? (
              <div className="small mt-1">{this.state.errorMessage}</div>
            ) : null}
          </div>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      );
    }

    // Remount children after retry to reset hook state
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

