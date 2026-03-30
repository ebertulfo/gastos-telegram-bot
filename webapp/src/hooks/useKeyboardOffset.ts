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
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") {
        setOpen(true);
      }
    };
    const onFocusOut = () => {
      setTimeout(() => setOpen(false), 100);
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
