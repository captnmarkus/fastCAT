import React from "react";

type SectionCardProps = {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export default function SectionCard({
  title,
  description,
  actions = null,
  children,
  className = ""
}: SectionCardProps) {
  const wrapperClass = className ? `fc-section-card ${className}` : "fc-section-card";
  return (
    <section className={wrapperClass}>
      {title || description || actions ? (
        <header className="fc-section-card-header">
          <div>
            {title ? <h4 className="fc-section-card-title">{title}</h4> : null}
            {description ? <p className="fc-section-card-description">{description}</p> : null}
          </div>
          {actions ? <div className="fc-section-card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="fc-section-card-body">{children}</div>
    </section>
  );
}
