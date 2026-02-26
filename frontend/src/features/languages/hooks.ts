import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchLanguages } from "./api";
import type { LanguageConfig } from "./types";

type LoadStatus = "idle" | "loading" | "success" | "error";

type LanguageState = {
  status: LoadStatus;
  data: LanguageConfig | null;
  error: string | null;
};

let state: LanguageState = { status: "idle", data: null, error: null };
let inFlight: Promise<LanguageConfig | null> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

async function loadLanguages(): Promise<LanguageConfig | null> {
  if (inFlight) return inFlight;
  state = { ...state, status: "loading", error: null };
  emit();
  inFlight = fetchLanguages()
    .then((data) => {
      state = { status: "success", data, error: null };
      emit();
      return data;
    })
    .catch((err: any) => {
      state = {
        status: "error",
        data: null,
        error: err?.userMessage || err?.message || "Failed to load language settings."
      };
      emit();
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function invalidateLanguages() {
  return loadLanguages();
}

export function useLanguages() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (snapshot.status === "idle") {
      void loadLanguages();
    }
  }, [snapshot.status]);

  const data = snapshot.data;
  const allLanguages = data?.languages ?? [];

  const derived = useMemo(() => {
    const activeLanguages = allLanguages.filter((entry) => entry.active);
    const activeSourceLanguages = activeLanguages.filter((entry) => entry.allowedAsSource);
    const activeTargetLanguages = activeLanguages.filter((entry) => entry.allowedAsTarget);
    return { activeLanguages, activeSourceLanguages, activeTargetLanguages };
  }, [allLanguages]);

  return {
    allLanguages,
    activeLanguages: derived.activeLanguages,
    activeSourceLanguages: derived.activeSourceLanguages,
    activeTargetLanguages: derived.activeTargetLanguages,
    defaults: data?.defaults ?? {},
    allowSingleLanguage: Boolean(data?.allowSingleLanguage),
    loading: snapshot.status === "idle" || snapshot.status === "loading",
    error: snapshot.error,
    refetch: invalidateLanguages
  };
}
