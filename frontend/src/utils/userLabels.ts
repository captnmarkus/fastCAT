export function buildUserLabelMap(
  users: Array<{ id: number; username: string; displayName?: string | null }>
) {
  const map: Record<string, string> = {};
  users.forEach((user) => {
    const label = user.displayName || user.username;
    map[String(user.id)] = label;
    map[String(user.username)] = label;
  });
  return map;
}

