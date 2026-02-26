import React, { useCallback, useEffect, useMemo, useState } from "react";

type TableDensity = "comfortable" | "compact";

type TableDensityContextValue = {
  density: TableDensity;
  setDensity: (density: TableDensity) => void;
};

const DEFAULT_DENSITY: TableDensity = "comfortable";

const TableDensityContext = React.createContext<TableDensityContextValue | null>(null);

function safeStorageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function normalizeDensity(value: string | null): TableDensity {
  return "comfortable";
}

function buildStorageKey(scope?: string | null) {
  const cleaned = String(scope || "").trim();
  if (!cleaned) return "fc:table:density";
  return `fc:${cleaned}:table:density`;
}

type TableDensityProviderProps = {
  children: React.ReactNode;
  storageScope?: string | null;
};

export function TableDensityProvider({ children, storageScope = null }: TableDensityProviderProps) {
  const storageKey = useMemo(() => buildStorageKey(storageScope), [storageScope]);
  const [density, setDensityState] = useState<TableDensity>(DEFAULT_DENSITY);

  useEffect(() => {
    const raw = safeStorageGet(storageKey);
    setDensityState(normalizeDensity(raw));
  }, [storageKey]);

  useEffect(() => {
    safeStorageSet(storageKey, density);
  }, [density, storageKey]);

  useEffect(() => {
    document.body.classList.remove("fc-density-compact", "fc-density-comfortable");
    document.body.classList.add(density === "compact" ? "fc-density-compact" : "fc-density-comfortable");
    return () => {
      document.body.classList.remove("fc-density-compact", "fc-density-comfortable");
    };
  }, [density]);

  const setDensity = useCallback((next: TableDensity) => {
    setDensityState("comfortable");
  }, []);

  const value = useMemo<TableDensityContextValue>(
    () => ({
      density,
      setDensity
    }),
    [density, setDensity]
  );

  return <TableDensityContext.Provider value={value}>{children}</TableDensityContext.Provider>;
}

export function useTableDensity() {
  const context = React.useContext(TableDensityContext);
  if (!context) {
    throw new Error("useTableDensity must be used within <TableDensityProvider />");
  }
  return context;
}
