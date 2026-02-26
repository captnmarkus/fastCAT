import React from "react";
import type { AuthUser } from "../../../types/app";
import ModernEditorFilePage from "./ModernEditorFilePage";

export default function EditorFilePage({ currentUser }: { currentUser: AuthUser | null }) {
  return <ModernEditorFilePage currentUser={currentUser} />;
}
