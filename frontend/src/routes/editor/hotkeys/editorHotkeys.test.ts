import { describe, expect, it } from "vitest";
import {
  createDefaultEditorKeymap,
  isEditorHotkeyAllowed,
  resolveEditorHotkeyAction,
  runConfirmAndAdvance,
  type EditorHotkeyActionId,
  type KeyboardLikeEvent,
  type KeyBinding
} from "./editorHotkeys";

function keyboardEventFromBinding(binding: KeyBinding): KeyboardLikeEvent {
  const code = binding.code;
  const inferredKey = code?.startsWith("Digit")
    ? code.slice("Digit".length)
    : code?.startsWith("Numpad")
    ? code.slice("Numpad".length)
    : binding.key ?? "";
  return {
    key: inferredKey,
    code,
    ctrlKey: binding.ctrlKey ?? false,
    metaKey: binding.metaKey ?? false,
    altKey: binding.altKey ?? false,
    shiftKey: binding.shiftKey ?? false
  };
}

describe("editor hotkeys defaults", () => {
  it("resolves each default Windows binding to its action", () => {
    const keymap = createDefaultEditorKeymap("win", { enableConcordanceCtrlK: true });
    for (const action of Object.keys(keymap) as EditorHotkeyActionId[]) {
      const bindings = keymap[action];
      for (const binding of bindings) {
        const event = keyboardEventFromBinding(binding);
        expect(resolveEditorHotkeyAction(event, keymap)).toBe(action);
      }
    }
  });

  it("supports mac revert fallbacks and can disable Cmd+K interception", () => {
    const enabled = createDefaultEditorKeymap("mac", { enableConcordanceCtrlK: true });
    expect(
      resolveEditorHotkeyAction(
        { key: "Home", code: "Home", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true },
        enabled
      )
    ).toBe("REVERT_STAGE");
    expect(
      resolveEditorHotkeyAction(
        {
          key: "ArrowLeft",
          code: "ArrowLeft",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: true
        },
        enabled
      )
    ).toBe("REVERT_STAGE");

    const disabled = createDefaultEditorKeymap("mac", { enableConcordanceCtrlK: false });
    expect(
      resolveEditorHotkeyAction(
        { key: "k", code: "KeyK", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false },
        disabled
      )
    ).toBe(null);
  });
});

describe("editor hotkey context gating", () => {
  it("does not allow shortcuts from unrelated form fields", () => {
    expect(
      isEditorHotkeyAllowed("NAV_NEXT", {
        withinEditor: true,
        hasActiveSegment: true,
        inModal: false,
        inTargetEditor: false,
        inSegmentRow: false,
        inSourceCell: false,
        inFormField: true
      })
    ).toBe(false);
  });

  it("allows shortcuts in target editing context", () => {
    expect(
      isEditorHotkeyAllowed("NAV_NEXT", {
        withinEditor: true,
        hasActiveSegment: true,
        inModal: false,
        inTargetEditor: true,
        inSegmentRow: true,
        inSourceCell: false,
        inFormField: true
      })
    ).toBe(true);
  });
});

describe("confirm+advance flow", () => {
  it("runs async confirm once and advances once", async () => {
    let confirmCalls = 0;
    let moveNextCalls = 0;
    let moveNextUnconfirmedCalls = 0;

    const result = await runConfirmAndAdvance({
      alreadyConfirmed: false,
      reviewMode: false,
      confirm: async () => {
        confirmCalls += 1;
        return true;
      },
      moveNext: () => {
        moveNextCalls += 1;
      },
      moveNextUnconfirmed: () => {
        moveNextUnconfirmedCalls += 1;
      }
    });

    expect(result).toBe(true);
    expect(confirmCalls).toBe(1);
    expect(moveNextCalls).toBe(1);
    expect(moveNextUnconfirmedCalls).toBe(0);
  });

  it("skips confirm call for already confirmed segments and uses review loop move", async () => {
    let confirmCalls = 0;
    let moveNextCalls = 0;
    let moveNextUnconfirmedCalls = 0;

    const result = await runConfirmAndAdvance({
      alreadyConfirmed: true,
      reviewMode: true,
      confirm: () => {
        confirmCalls += 1;
        return true;
      },
      moveNext: () => {
        moveNextCalls += 1;
      },
      moveNextUnconfirmed: () => {
        moveNextUnconfirmedCalls += 1;
      }
    });

    expect(result).toBe(true);
    expect(confirmCalls).toBe(0);
    expect(moveNextCalls).toBe(0);
    expect(moveNextUnconfirmedCalls).toBe(1);
  });
});

