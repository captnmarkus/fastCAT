import React, { useEffect, useMemo } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useShellSecondaryNav } from "../../components/Shell";

function tabClass({ isActive }: { isActive: boolean }) {
  return `nav-link fc-topnav-link${isActive ? " active" : ""}`;
}

function ResourcesTabs() {
  const tabs = useMemo(
    () => [
      { to: "/resources/templates", label: "Project Templates" },
      { to: "/resources/file-types", label: "File Type Configurations" },
      { to: "/resources/json-templates", label: "JSON Templates" },
      { to: "/resources/translation-engines", label: "Translation Engines" },
      { to: "/resources/translation-memories", label: "Translation Memories" },
      { to: "/resources/terminology", label: "Terminology" },
      { to: "/resources/rules", label: "Rules" },
      { to: "/resources/nmt-providers", label: "NMT/LLM Providers" }
    ],
    []
  );

  return (
    <ul className="nav" aria-label="Resources tabs">
      {tabs.map((tab) => (
        <li className="nav-item" key={tab.to}>
          <NavLink className={tabClass} to={tab.to}>
            {tab.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export default function ResourcesShell() {
  const { setSecondaryNav } = useShellSecondaryNav();

  useEffect(() => {
    setSecondaryNav(<ResourcesTabs />);
    return () => setSecondaryNav(null);
  }, [setSecondaryNav]);

  return <Outlet />;
}
