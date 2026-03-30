import { useState, useEffect } from "react";

/**
 * Returns true when an input is focused (keyboard is likely open).
 *
 * Telegram's iOS WebView doesn't resize the viewport when the keyboard
 * opens, so we can't detect the keyboard height. Instead we just track
 * whether an input is focused so the drawer can shrink its maxHeight.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") {
        clearTimeout(timerId);
        // Delay to let iOS keyboard animation start (~100ms)
        // so drawer shrink and keyboard slide happen together
        timerId = setTimeout(() => setOpen(true), 100);
      }
    };
    const onFocusOut = () => {
      clearTimeout(timerId);
      setTimeout(() => setOpen(false), 50);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return open;
}
