// @ts-nocheck
import { useEffect, useMemo } from "react";
import { filterAssignableUsers } from "../shared/components/UserSelect";
import { parsePositiveInt } from "../../../utils/ids";
import { normalizeTargetKey } from "./useProjectCreateWizard.logic";

export function useProjectCreateWizardAssignments(ctx: any) {
  const {
    canAssign,
    currentUser,
    currentUserKey,
    defaultAssigneeId,
    defaultTmxId,
    departmentId,
    isAdmin,
    isReviewer,
    legacyTmxRef,
    projectTargetLangs,
    setDefaultAssigneeId,
    setDefaultTmxId,
    setGlossaryByTargetLang,
    setRulesetByTargetLang,
    setTmxByTargetLang,
    setTranslationPlanMode,
    setUseSameAssignee,
    tmSamples,
    tmxByTargetLang,
    translationPlanMode,
    useSameAssignee,
    users
  } = ctx;
const assignmentUsers = useMemo(() => {
  if (!users.length) return [];
  if (!isAdmin) return users;
  const currentId = String(currentUser.id || "");
  const currentName = String(currentUser.username || "");
  return users.filter((user) => {
    if (user.role !== "admin") return true;
    return String(user.id) === currentId || String(user.username) === currentName;
  });
}, [currentUser.id, currentUser.username, isAdmin, users]);
const assignableUsers = useMemo(
  () => filterAssignableUsers(assignmentUsers, departmentId, { allowAdmins: isAdmin }),
  [assignmentUsers, departmentId, isAdmin]
);
const reviewerUser = useMemo<AdminUser | null>(() => {
  if (!isReviewer) return null;
  return {
    id: Number(currentUser.id),
    username: currentUser.username,
    displayName: currentUser.displayName || currentUser.username,
    role: "reviewer",
    departmentId: currentUser.departmentId ?? null,
    disabled: false,
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };
}, [currentUser, isReviewer]);
const translationPlanUsers = useMemo(
  () => (reviewerUser ? [reviewerUser] : assignmentUsers),
  [assignmentUsers, reviewerUser]
);

useEffect(() => {
  if (!canAssign) {
    if (defaultAssigneeId !== currentUserKey) {
      setDefaultAssigneeId(currentUserKey);
    }
    return;
  }
  const assigneeMatch = assignableUsers.find(
    (user) => String(user.username) === String(defaultAssigneeId) || String(user.id) === String(defaultAssigneeId)
  );
  if (!assigneeMatch) {
    setDefaultAssigneeId(assignableUsers[0] ? String(assignableUsers[0].username) : "");
  } else if (String(assigneeMatch.username) !== String(defaultAssigneeId)) {
    setDefaultAssigneeId(String(assigneeMatch.username));
  }
}, [assignableUsers, canAssign, currentUserKey, defaultAssigneeId]);

useEffect(() => {
  if (!isReviewer) return;
  if (translationPlanMode !== "simple") setTranslationPlanMode("simple");
  if (!useSameAssignee) setUseSameAssignee(true);
}, [isReviewer, translationPlanMode, useSameAssignee]);

const tmSampleByFilename = useMemo(() => {
  const map = new Map<string, SampleAsset>();
  tmSamples.forEach((sample) => {
    if (sample.filename) map.set(sample.filename, sample);
  });
  return map;
}, [tmSamples]);

const tmSampleById = useMemo(() => {
  const map = new Map<number, SampleAsset>();
  tmSamples.forEach((sample) => {
    const id = parsePositiveInt(sample.tmId);
    if (id != null) {
      map.set(id, sample);
    }
  });
  return map;
}, [tmSamples]);

useEffect(() => {
  const legacy = legacyTmxRef.current;
  if (!tmSamples.length) return;
  if (!legacy.defaultFilename && Object.keys(legacy.selections).length === 0) return;

  if (legacy.defaultFilename && defaultTmxId == null) {
    const legacyDefault = tmSampleByFilename.get(legacy.defaultFilename);
    if (legacyDefault?.tmId != null) {
      setDefaultTmxId(Number(legacyDefault.tmId));
    }
  }

  if (Object.keys(legacy.selections).length > 0 && Object.keys(tmxByTargetLang).length === 0) {
    const next: Record<string, number | null> = {};
    Object.entries(legacy.selections).forEach(([key, filename]) => {
      const normalizedKey = normalizeTargetKey(key);
      if (!normalizedKey) return;
      const sample = tmSampleByFilename.get(filename);
      next[normalizedKey] = parsePositiveInt(sample?.tmId) ?? null;
    });
    if (Object.keys(next).length > 0) {
      setTmxByTargetLang(next);
    }
  }

  legacyTmxRef.current = { defaultFilename: "", selections: {} };
}, [defaultTmxId, tmSampleByFilename, tmSamples.length, tmxByTargetLang]);

useEffect(() => {
  setTmxByTargetLang((prev) => {
    const normalizedPrev: Record<string, number | null> = {};
    Object.entries(prev).forEach(([key, value]) => {
      const normalizedKey = normalizeTargetKey(key);
      if (!normalizedKey) return;
      normalizedPrev[normalizedKey] = value ?? null;
    });
    const targets = projectTargetLangs.map((lang) => normalizeTargetKey(lang)).filter(Boolean);
    const next: Record<string, number | null> = {};

    targets.forEach((target) => {
      if (Object.prototype.hasOwnProperty.call(normalizedPrev, target)) {
        next[target] = normalizedPrev[target] ?? null;
      }
    });

    const prevKeys = Object.keys(normalizedPrev);
    const nextKeys = Object.keys(next);
    const changed =
      prevKeys.length !== nextKeys.length ||
      prevKeys.some((key) => normalizedPrev[key] !== next[key]);

    return changed ? next : prev;
  });
}, [projectTargetLangs]);

useEffect(() => {
  setRulesetByTargetLang((prev) => {
    const normalizedPrev: Record<string, number | null> = {};
    Object.entries(prev).forEach(([key, value]) => {
      const normalizedKey = normalizeTargetKey(key);
      if (!normalizedKey) return;
      normalizedPrev[normalizedKey] = value ?? null;
    });
    const targets = projectTargetLangs.map((lang) => normalizeTargetKey(lang)).filter(Boolean);
    const next: Record<string, number | null> = {};

    targets.forEach((target) => {
      if (Object.prototype.hasOwnProperty.call(normalizedPrev, target)) {
        next[target] = normalizedPrev[target] ?? null;
      }
    });

    const prevKeys = Object.keys(normalizedPrev);
    const nextKeys = Object.keys(next);
    const changed =
      prevKeys.length !== nextKeys.length ||
      prevKeys.some((key) => normalizedPrev[key] !== next[key]);

    return changed ? next : prev;
  });
}, [projectTargetLangs]);

useEffect(() => {
  setGlossaryByTargetLang((prev) => {
    const normalizedPrev: Record<string, number | null> = {};
    Object.entries(prev).forEach(([key, value]) => {
      const normalizedKey = normalizeTargetKey(key);
      if (!normalizedKey) return;
      normalizedPrev[normalizedKey] = value ?? null;
    });
    const targets = projectTargetLangs.map((lang) => normalizeTargetKey(lang)).filter(Boolean);
    const next: Record<string, number | null> = {};

    targets.forEach((target) => {
      if (Object.prototype.hasOwnProperty.call(normalizedPrev, target)) {
        next[target] = normalizedPrev[target] ?? null;
      }
    });

    const prevKeys = Object.keys(normalizedPrev);
    const nextKeys = Object.keys(next);
    const changed =
      prevKeys.length !== nextKeys.length ||
      prevKeys.some((key) => normalizedPrev[key] !== next[key]);

    return changed ? next : prev;
  });
}, [projectTargetLangs]);


  return {
    assignmentUsers,
    assignableUsers,
    translationPlanUsers,
    tmSampleByFilename,
    tmSampleById
  };
}
