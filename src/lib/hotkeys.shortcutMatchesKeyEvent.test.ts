/**
 * Tests for `shortcutMatchesKeyEvent` and `detectIsMac` (expanded-popup-focus-trap-fix,
 * GitHub issue #18: the Content_Script recognises its own hotkeys and keeps
 * their `keydown` away from page handlers).
 */
import fc from "fast-check";

import {
  detectIsMac,
  keyEventToShortcut,
  shortcutMatchesKeyEvent,
  type KeyDescriptor,
  type ShortcutKeyEvent,
} from "./hotkeys.js";

/** Keys with a grammar token, paired with the `event.code` a US layout reports. */
const KEYS: ReadonlyArray<{ key: string; code: string }> = [
  { key: "ArrowDown", code: "ArrowDown" },
  { key: "ArrowUp", code: "ArrowUp" },
  { key: "ArrowLeft", code: "ArrowLeft" },
  { key: "ArrowRight", code: "ArrowRight" },
  { key: "a", code: "KeyA" },
  { key: "j", code: "KeyJ" },
  { key: "Z", code: "KeyZ" },
  { key: "1", code: "Digit1" },
  { key: "9", code: "Digit9" },
  { key: " ", code: "Space" },
  { key: ",", code: "Comma" },
  { key: ".", code: "Period" },
  { key: "F5", code: "F5" },
  { key: "PageDown", code: "PageDown" },
  { key: "Home", code: "Home" },
];

/** A key event; `meta` only on macOS, where the recorder maps it to `Command`. */
const keyEvent: fc.Arbitrary<ShortcutKeyEvent> = fc
  .record({
    ctrl: fc.boolean(),
    alt: fc.boolean(),
    shift: fc.boolean(),
    meta: fc.boolean(),
    isMac: fc.boolean(),
    keyIndex: fc.nat({ max: KEYS.length - 1 }),
  })
  .map(({ keyIndex, ...flags }) => ({
    ...flags,
    meta: flags.isMac && flags.meta,
    ...KEYS[keyIndex],
  }));

function press(partial: Partial<ShortcutKeyEvent> & Pick<ShortcutKeyEvent, "key" | "code">): ShortcutKeyEvent {
  return { ctrl: false, alt: false, shift: false, meta: false, isMac: false, ...partial };
}

describe("shortcutMatchesKeyEvent", () => {
  // **Validates: the guard recognises every shortcut the Options_Page can record**
  it("matches the event a recorded shortcut came from", () => {
    fc.assert(
      fc.property(keyEvent, (event) => {
        const shortcut = keyEventToShortcut(event as KeyDescriptor);
        fc.pre(shortcut !== null);
        expect(shortcutMatchesKeyEvent(shortcut as string, event)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("does not match when one modifier is added or released", () => {
    const modifiers = ["ctrl", "alt", "shift", "meta"] as const;
    fc.assert(
      fc.property(keyEvent, fc.constantFrom(...modifiers), (event, flip) => {
        const shortcut = keyEventToShortcut(event as KeyDescriptor);
        fc.pre(shortcut !== null);
        // Outside macOS the recorder ignores meta, but Firefox still requires it
        // to be released, so flipping it must break the match there too.
        const flipped = { ...event, [flip]: !event[flip] };
        expect(shortcutMatchesKeyEvent(shortcut as string, flipped)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("does not match a different key with the same modifiers", () => {
    fc.assert(
      fc.property(keyEvent, fc.nat({ max: KEYS.length - 1 }), (event, otherIndex) => {
        const shortcut = keyEventToShortcut(event as KeyDescriptor);
        const other = { ...event, ...KEYS[otherIndex] };
        fc.pre(shortcut !== null && other.code !== event.code);
        expect(shortcutMatchesKeyEvent(shortcut as string, other)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  describe("the default hotkeys", () => {
    const altShiftDown = press({ alt: true, shift: true, key: "ArrowDown", code: "ArrowDown" });

    it("matches Alt+Shift+Down and Alt+Shift+Up", () => {
      expect(shortcutMatchesKeyEvent("Alt+Shift+Down", altShiftDown)).toBe(true);
      expect(
        shortcutMatchesKeyEvent(
          "Alt+Shift+Up",
          press({ alt: true, shift: true, key: "ArrowUp", code: "ArrowUp" }),
        ),
      ).toBe(true);
    });

    it.each([
      ["plain ArrowDown", press({ key: "ArrowDown", code: "ArrowDown" })],
      ["Alt+Down", press({ alt: true, key: "ArrowDown", code: "ArrowDown" })],
      ["Shift+Down", press({ shift: true, key: "ArrowDown", code: "ArrowDown" })],
      [
        "Ctrl+Alt+Shift+Down",
        press({ ctrl: true, alt: true, shift: true, key: "ArrowDown", code: "ArrowDown" }),
      ],
      ["Alt+Shift+Up", press({ alt: true, shift: true, key: "ArrowUp", code: "ArrowUp" })],
    ])("does not match %s", (_name, event) => {
      expect(shortcutMatchesKeyEvent("Alt+Shift+Down", event)).toBe(false);
    });

    it("tolerates spacing and casing in the stored shortcut", () => {
      expect(shortcutMatchesKeyEvent(" alt + SHIFT + down ", altShiftDown)).toBe(true);
    });
  });

  describe("platform modifiers", () => {
    it("treats Ctrl and Command as the Command key on macOS", () => {
      const commandShiftY = press({ meta: true, shift: true, key: "y", code: "KeyY", isMac: true });
      expect(shortcutMatchesKeyEvent("Ctrl+Shift+Y", commandShiftY)).toBe(true);
      expect(shortcutMatchesKeyEvent("Command+Shift+Y", commandShiftY)).toBe(true);
      // The physical Control key on macOS is MacCtrl, not Ctrl.
      const controlShiftY = press({ ctrl: true, shift: true, key: "y", code: "KeyY", isMac: true });
      expect(shortcutMatchesKeyEvent("Ctrl+Shift+Y", controlShiftY)).toBe(false);
      expect(shortcutMatchesKeyEvent("MacCtrl+Shift+Y", controlShiftY)).toBe(true);
    });

    it("treats Ctrl, Command and MacCtrl as the Control key elsewhere", () => {
      const ctrlShiftY = press({ ctrl: true, shift: true, key: "Y", code: "KeyY" });
      expect(shortcutMatchesKeyEvent("Ctrl+Shift+Y", ctrlShiftY)).toBe(true);
      expect(shortcutMatchesKeyEvent("Command+Shift+Y", ctrlShiftY)).toBe(true);
      expect(shortcutMatchesKeyEvent("MacCtrl+Shift+Y", ctrlShiftY)).toBe(true);
    });

    it("matches by physical key when a modifier changes event.key", () => {
      // Option+Shift+K on macOS reports a symbol, Shift+1 reports "!".
      expect(
        shortcutMatchesKeyEvent(
          "Alt+Shift+K",
          press({ alt: true, shift: true, key: "\uF8FF", code: "KeyK", isMac: true }),
        ),
      ).toBe(true);
      expect(
        shortcutMatchesKeyEvent(
          "Ctrl+Shift+1",
          press({ ctrl: true, shift: true, key: "!", code: "Digit1" }),
        ),
      ).toBe(true);
    });
  });

  it.each(["", "   ", "+", "Hyper+Down", "Alt+Shift+"])(
    "never matches the unassigned or malformed shortcut %j",
    (shortcut) => {
      expect(
        shortcutMatchesKeyEvent(
          shortcut,
          press({ alt: true, shift: true, key: "ArrowDown", code: "ArrowDown" }),
        ),
      ).toBe(false);
    },
  );
});

describe("detectIsMac", () => {
  const fakeNavigator = (platform: string, uaPlatform?: string): Navigator =>
    ({
      platform,
      ...(uaPlatform === undefined ? {} : { userAgentData: { platform: uaPlatform } }),
    }) as unknown as Navigator;

  it.each([
    ["MacIntel", undefined, true],
    ["Win32", undefined, false],
    ["Linux x86_64", undefined, false],
    ["", "macOS", true],
    ["MacIntel", "Windows", false],
  ])("platform %j / userAgentData %j → %s", (platform, uaPlatform, expected) => {
    expect(detectIsMac(fakeNavigator(platform, uaPlatform))).toBe(expected);
  });
});
