import React, { useMemo } from "react";
import type { AdminUser } from "../../../../api";

export type UserSelectProps = {
  users: AdminUser[];
  departmentId?: number | string | null;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  includeEmpty?: boolean;
  emptyLabel?: string;
  allowAdmins?: boolean;
  className?: string;
};

export function filterAssignableUsers(
  users: AdminUser[],
  departmentId?: number | string | null,
  opts?: { allowAdmins?: boolean; includeDisabled?: boolean }
) {
  const allowAdmins = Boolean(opts?.allowAdmins);
  const includeDisabled = Boolean(opts?.includeDisabled);
  const dept = departmentId != null ? Number(departmentId) : null;
  let candidates = users;
  if (!includeDisabled) {
    candidates = candidates.filter((user) => !user.disabled);
  }
  if (!allowAdmins) {
    candidates = candidates.filter((user) => user.role !== "admin");
  }
  if (dept != null && Number.isFinite(dept) && dept > 0) {
    candidates = candidates.filter((user) => {
      if (allowAdmins && user.role === "admin") return true;
      return user.departmentId === dept;
    });
  } else if (dept != null) {
    candidates = [];
  }
  return candidates.slice().sort((a, b) => {
    const labelA = String(a.displayName || a.username || "").toLowerCase();
    const labelB = String(b.displayName || b.username || "").toLowerCase();
    return labelA.localeCompare(labelB);
  });
}

export default function UserSelect(props: UserSelectProps) {
  const {
    users,
    departmentId,
    value,
    onChange,
    disabled,
    includeEmpty,
    emptyLabel,
    allowAdmins,
    className
  } = props;

  const options = useMemo(
    () => filterAssignableUsers(users, departmentId, { allowAdmins }),
    [allowAdmins, departmentId, users]
  );
  const resolvedValue = useMemo(() => {
    if (!value) return value;
    const match = options.find(
      (user) => String(user.username) === String(value) || String(user.id) === String(value)
    );
    return match ? String(match.username) : value;
  }, [options, value]);

  return (
    <select
      className={className || "form-select"}
      value={resolvedValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || options.length === 0}
    >
      {includeEmpty && <option value="">{emptyLabel || "Unassigned"}</option>}
      {options.map((user) => (
        <option key={user.id} value={user.username}>
          {user.displayName || user.username}
        </option>
      ))}
    </select>
  );
}
