export type AuthUser = {
  id: number;
  username: string;
  role: string;
  departmentId?: number | null;
  displayName?: string | null;
  email?: string | null;
  disabled?: boolean;
  mustChangePassword?: boolean;
};

export type SegmentStatus = "draft" | "under_review" | "reviewed";
export type SegmentState = "draft" | "nmt_draft" | "reviewed";

export type ProjectCardMeta = {
  label: string;
  tone: "success" | "danger" | "warning" | "secondary";
  pending: number;
  total: number;
};
