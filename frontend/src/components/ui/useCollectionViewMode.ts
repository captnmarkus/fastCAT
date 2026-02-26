import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { safeLocalStorageGet, safeLocalStorageSet } from "../../routes/projects/shared/storage";

export type ViewMode = "cards" | "list";

type UseCollectionViewModeOptions = {
  storageKey: string;
  defaultMode?: ViewMode;
  queryParam?: string;
  replaceHistory?: boolean;
};

function parseViewMode(raw: string | null | undefined): ViewMode | null {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "cards" || normalized === "card" || normalized === "grid") return "cards";
  if (normalized === "list" || normalized === "table") return "list";
  return null;
}

function modeFromSearch(search: string, queryParam: string): ViewMode | null {
  const params = new URLSearchParams(search);
  return parseViewMode(params.get(queryParam));
}

export default function useCollectionViewMode({
  storageKey,
  defaultMode = "cards",
  queryParam = "view",
  replaceHistory = true
}: UseCollectionViewModeOptions) {
  const location = useLocation();
  const navigate = useNavigate();

  const storageDefault = useMemo(() => {
    const persisted = parseViewMode(safeLocalStorageGet(storageKey));
    return persisted ?? defaultMode;
  }, [defaultMode, storageKey]);

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return storageDefault;
    const fromQuery = modeFromSearch(window.location.search, queryParam);
    return fromQuery ?? storageDefault;
  });

  useEffect(() => {
    safeLocalStorageSet(storageKey, viewMode);
  }, [storageKey, viewMode]);

  useEffect(() => {
    const fromQuery = modeFromSearch(location.search, queryParam);
    if (fromQuery && fromQuery !== viewMode) {
      setViewModeState(fromQuery);
    }
  }, [location.search, queryParam, viewMode]);

  const setViewMode = useCallback(
    (next: ViewMode) => {
      setViewModeState(next);
      safeLocalStorageSet(storageKey, next);

      const params = new URLSearchParams(location.search);
      if (params.get(queryParam) === next) return;
      params.set(queryParam, next);

      const nextSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : ""
        },
        { replace: replaceHistory }
      );
    },
    [location.pathname, location.search, navigate, queryParam, replaceHistory, storageKey]
  );

  return { viewMode, setViewMode };
}
