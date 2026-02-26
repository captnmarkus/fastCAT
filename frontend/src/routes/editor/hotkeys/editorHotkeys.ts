export type EditorHotkeyPlatform = "mac" | "win";

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
type HotkeyDigit = (typeof DIGITS)[number];

export type EditorHotkeyActionId =
  | "SEGMENT_CONFIRM"
  | "NAV_NEXT"
  | "NAV_PREV"
  | "NAV_NEXT_UNCONFIRMED"
  | "FOCUS_TOGGLE_SOURCE_TARGET"
  | "NAV_NEXT_TERM_ISSUE"
  | "COPY_SOURCE_TO_TARGET"
  | "GOTO_SEGMENT_DIALOG"
  | "OPEN_CONCORDANCE"
  | "NAV_CAT_UP"
  | "NAV_CAT_DOWN"
  | "REVERT_STAGE"
  | `INSERT_CAT_SUGGESTION_${HotkeyDigit}`
  | `INSERT_TAG_${HotkeyDigit}`;

export type KeyBinding = {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type EditorHotkeyMap = Record<EditorHotkeyActionId, KeyBinding[]>;

export type KeyboardLikeEvent = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type EditorHotkeyContext = {
  withinEditor: boolean;
  hasActiveSegment: boolean;
  inModal: boolean;
  inTargetEditor: boolean;
  inSegmentRow: boolean;
  inSourceCell: boolean;
  inFormField: boolean;
};

export const EDITOR_HOTKEY_ACTION_ORDER: EditorHotkeyActionId[] = [
  "SEGMENT_CONFIRM",
  "NAV_NEXT",
  "NAV_PREV",
  "NAV_NEXT_UNCONFIRMED",
  "FOCUS_TOGGLE_SOURCE_TARGET",
  "NAV_NEXT_TERM_ISSUE",
  "COPY_SOURCE_TO_TARGET",
  "GOTO_SEGMENT_DIALOG",
  "OPEN_CONCORDANCE",
  "NAV_CAT_UP",
  "NAV_CAT_DOWN",
  "REVERT_STAGE",
  ...DIGITS.map((digit) => `INSERT_CAT_SUGGESTION_${digit}` as const),
  ...DIGITS.map((digit) => `INSERT_TAG_${digit}` as const)
];

const ACTION_LABELS: Record<EditorHotkeyActionId, string> = {
  SEGMENT_CONFIRM: "Confirm/Approve current segment",
  NAV_NEXT: "Go to next segment",
  NAV_PREV: "Go to previous segment",
  NAV_NEXT_UNCONFIRMED: "Go to next unconfirmed segment",
  FOCUS_TOGGLE_SOURCE_TARGET: "Toggle focus Source/Target",
  NAV_NEXT_TERM_ISSUE: "Go to next terminology issue",
  COPY_SOURCE_TO_TARGET: "Copy Source to Target",
  GOTO_SEGMENT_DIALOG: "Go to segment number",
  OPEN_CONCORDANCE: "Open concordance search",
  NAV_CAT_UP: "Navigate CAT results up",
  NAV_CAT_DOWN: "Navigate CAT results down",
  REVERT_STAGE: "Revert segment to previous stage",
  INSERT_CAT_SUGGESTION_1: "Insert CAT suggestion #1",
  INSERT_CAT_SUGGESTION_2: "Insert CAT suggestion #2",
  INSERT_CAT_SUGGESTION_3: "Insert CAT suggestion #3",
  INSERT_CAT_SUGGESTION_4: "Insert CAT suggestion #4",
  INSERT_CAT_SUGGESTION_5: "Insert CAT suggestion #5",
  INSERT_CAT_SUGGESTION_6: "Insert CAT suggestion #6",
  INSERT_CAT_SUGGESTION_7: "Insert CAT suggestion #7",
  INSERT_CAT_SUGGESTION_8: "Insert CAT suggestion #8",
  INSERT_CAT_SUGGESTION_9: "Insert CAT suggestion #9",
  INSERT_TAG_1: "Insert tag #1",
  INSERT_TAG_2: "Insert tag #2",
  INSERT_TAG_3: "Insert tag #3",
  INSERT_TAG_4: "Insert tag #4",
  INSERT_TAG_5: "Insert tag #5",
  INSERT_TAG_6: "Insert tag #6",
  INSERT_TAG_7: "Insert tag #7",
  INSERT_TAG_8: "Insert tag #8",
  INSERT_TAG_9: "Insert tag #9"
};

function emptyKeymap(): EditorHotkeyMap {
  const map = {} as EditorHotkeyMap;
  for (const action of EDITOR_HOTKEY_ACTION_ORDER) map[action] = [];
  return map;
}

function letterBinding(
  letter: string,
  modifiers: Omit<KeyBinding, "key" | "code">
): KeyBinding {
  return { key: letter.toLowerCase(), ...modifiers };
}

function normalizeToken(value: string | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function detectEditorHotkeyPlatform(
  platformHint: string | undefined = typeof navigator !== "undefined" ? navigator.platform : undefined,
  userAgentHint: string | undefined = typeof navigator !== "undefined" ? navigator.userAgent : undefined
): EditorHotkeyPlatform {
  const platform = normalizeToken(platformHint);
  const userAgent = normalizeToken(userAgentHint);
  if (platform.includes("mac") || userAgent.includes("mac")) return "mac";
  return "win";
}

export function keyBindingMatchesEvent(event: KeyboardLikeEvent, binding: KeyBinding): boolean {
  if (!binding.key && !binding.code) return false;

  const expectedCtrl = binding.ctrlKey ?? false;
  const expectedMeta = binding.metaKey ?? false;
  const expectedAlt = binding.altKey ?? false;
  const expectedShift = binding.shiftKey ?? false;
  if (event.ctrlKey !== expectedCtrl) return false;
  if (event.metaKey !== expectedMeta) return false;
  if (event.altKey !== expectedAlt) return false;
  if (event.shiftKey !== expectedShift) return false;

  if (binding.code) return String(event.code || "") === binding.code;
  return normalizeToken(event.key) === normalizeToken(binding.key);
}

export function resolveEditorHotkeyAction(
  event: KeyboardLikeEvent,
  keymap: EditorHotkeyMap
): EditorHotkeyActionId | null {
  for (const action of EDITOR_HOTKEY_ACTION_ORDER) {
    const bindings = keymap[action] ?? [];
    if (bindings.some((binding) => keyBindingMatchesEvent(event, binding))) {
      return action;
    }
  }
  return null;
}

export function isEditorHotkeyAllowed(action: EditorHotkeyActionId, context: EditorHotkeyContext): boolean {
  if (!context.withinEditor || !context.hasActiveSegment || context.inModal) return false;
  if (context.inFormField && !context.inTargetEditor) return false;

  const inSegmentContext =
    context.inTargetEditor || context.inSegmentRow || context.inSourceCell;

  if (action === "NAV_CAT_UP" || action === "NAV_CAT_DOWN") return context.inTargetEditor;
  if (action.startsWith("INSERT_CAT_SUGGESTION_")) return context.inTargetEditor;
  if (action.startsWith("INSERT_TAG_")) return context.inTargetEditor;
  return inSegmentContext;
}

export function createDefaultEditorKeymap(
  platform: EditorHotkeyPlatform,
  opts?: { enableConcordanceCtrlK?: boolean }
): EditorHotkeyMap {
  const includeConcordance = opts?.enableConcordanceCtrlK !== false;
  const keymap = emptyKeymap();
  const isMac = platform === "mac";

  keymap.SEGMENT_CONFIRM = [
    isMac
      ? { key: "Enter", metaKey: true }
      : { key: "Enter", ctrlKey: true }
  ];

  keymap.NAV_NEXT = [{ key: "Enter" }, { key: "ArrowDown" }];
  keymap.NAV_PREV = [{ key: "ArrowUp" }];
  keymap.NAV_NEXT_UNCONFIRMED = [{ key: "F9" }];
  keymap.FOCUS_TOGGLE_SOURCE_TARGET = [{ key: "Tab" }];
  keymap.NAV_NEXT_TERM_ISSUE = [{ key: "F7" }];

  keymap.COPY_SOURCE_TO_TARGET = isMac
    ? [{ key: "S", metaKey: true, shiftKey: true }]
    : [{ key: "Insert", code: "Insert", ctrlKey: true }];

  keymap.GOTO_SEGMENT_DIALOG = [
    isMac ? letterBinding("g", { metaKey: true }) : letterBinding("g", { ctrlKey: true })
  ];

  keymap.OPEN_CONCORDANCE = includeConcordance
    ? [isMac ? letterBinding("k", { metaKey: true }) : letterBinding("k", { ctrlKey: true })]
    : [];

  keymap.NAV_CAT_UP = [{ key: "ArrowUp", ctrlKey: true }];
  keymap.NAV_CAT_DOWN = [{ key: "ArrowDown", ctrlKey: true }];

  keymap.REVERT_STAGE = isMac
    ? [{ key: "Home", shiftKey: true }, { key: "ArrowLeft", shiftKey: true }]
    : [{ key: "Delete", altKey: true, shiftKey: true }];

  for (const digit of DIGITS) {
    const catAction = `INSERT_CAT_SUGGESTION_${digit}` as const;
    const tagAction = `INSERT_TAG_${digit}` as const;
    keymap[catAction] = [{ code: `Digit${digit}`, ctrlKey: true }];
    keymap[tagAction] = [{ code: `Digit${digit}`, altKey: true }];
  }

  return keymap;
}

function keyTokenForBinding(binding: KeyBinding) {
  const code = String(binding.code || "");
  if (code.startsWith("Digit")) return code.slice("Digit".length);
  if (code.startsWith("Numpad")) return code.slice("Numpad".length);
  if (binding.key) return binding.key;
  return code;
}

function formatKeyToken(rawToken: string) {
  const token = String(rawToken || "");
  if (!token) return "";
  const lower = token.toLowerCase();
  if (lower === "arrowup") return "ArrowUp";
  if (lower === "arrowdown") return "ArrowDown";
  if (lower === "arrowleft") return "ArrowLeft";
  if (lower === "arrowright") return "ArrowRight";
  if (lower === "enter") return "Enter";
  if (lower === "tab") return "Tab";
  if (lower === "insert") return "Insert";
  if (lower === "delete") return "Delete";
  if (lower === "home") return "Home";
  if (/^f\d+$/i.test(token)) return token.toUpperCase();
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  return token;
}

export function formatKeyBinding(binding: KeyBinding, platform: EditorHotkeyPlatform): string {
  const parts: string[] = [];
  if (binding.ctrlKey) parts.push("Ctrl");
  if (binding.metaKey) parts.push(platform === "mac" ? "Cmd" : "Meta");
  if (binding.altKey) parts.push(platform === "mac" ? "Option" : "Alt");
  if (binding.shiftKey) parts.push("Shift");
  parts.push(formatKeyToken(keyTokenForBinding(binding)));
  return parts.join(" + ");
}

export function hotkeyActionLabel(action: EditorHotkeyActionId): string {
  return ACTION_LABELS[action];
}

export function parseDigitFromAction(
  action: EditorHotkeyActionId,
  prefix: "INSERT_CAT_SUGGESTION_" | "INSERT_TAG_"
): number | null {
  if (!action.startsWith(prefix)) return null;
  const value = Number(action.slice(prefix.length));
  if (!Number.isFinite(value) || value < 1 || value > 9) return null;
  return value;
}

export async function runConfirmAndAdvance(params: {
  alreadyConfirmed: boolean;
  reviewMode: boolean;
  confirm: () => boolean | Promise<boolean>;
  moveNext: () => void;
  moveNextUnconfirmed: () => void;
}): Promise<boolean> {
  const moveForward = () => {
    if (params.reviewMode) params.moveNextUnconfirmed();
    else params.moveNext();
  };

  if (params.alreadyConfirmed) {
    moveForward();
    return true;
  }

  const confirmed = await params.confirm();
  if (!confirmed) return false;
  moveForward();
  return true;
}

