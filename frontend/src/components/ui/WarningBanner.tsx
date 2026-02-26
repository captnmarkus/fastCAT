import React from "react";

type WarningBannerProps = {
  messages: string[];
  title?: string;
  tone?: "warning" | "error" | "info" | "success";
  className?: string;
};

const TONE_ICON: Record<NonNullable<WarningBannerProps["tone"]>, string> = {
  warning: "bi-exclamation-triangle",
  error: "bi-x-octagon",
  info: "bi-info-circle",
  success: "bi-check-circle"
};

export default function WarningBanner({
  messages,
  title,
  tone = "warning",
  className = ""
}: WarningBannerProps) {
  if (!messages || messages.length === 0) return null;
  const wrapperClass = className
    ? `fc-warning-banner is-${tone} ${className}`
    : `fc-warning-banner is-${tone}`;
  return (
    <div className={wrapperClass} role="alert">
      <div className="fc-warning-banner-icon" aria-hidden="true">
        <i className={`bi ${TONE_ICON[tone]}`} />
      </div>
      <div className="fc-warning-banner-content">
        {title ? <div className="fc-warning-banner-title">{title}</div> : null}
        {messages.length === 1 ? (
          <div className="fc-warning-banner-message">{messages[0]}</div>
        ) : (
          <ul className="fc-warning-banner-list">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
