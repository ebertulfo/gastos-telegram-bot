import { useState, useEffect } from "react";

/**
 * Detects iOS keyboard height in Telegram Mini App WebView.
 *
 * Telegram's iOS WebView doesn't resize the viewport when the keyboard opens —
 * visualViewport, innerHeight, and WebApp.viewportHeight all stay constant.
 * So we use a hardcoded estimate based on device screen height.
 */
function estimateKeyboardHeight(): number {
  const h = window.screen.height;
  if (h <= 667) return 260;  // iPhone SE
  if (h <= 844) return 300;  // iPhone 12/13/14
  if (h <= 932) return 340;  // iPhone Pro Max / Plus
  return 320;
}

export function useKeyboardOffset() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const initialHeight = window.innerHeight;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && target.tagName !== "SELECT") return;

      // Wait for keyboard animation
      setTimeout(() => {
        const diff = initialHeight - window.innerHeight;
        // If viewport actually shrank (non-Telegram), use real diff.
        // Otherwise fall back to estimate (Telegram iOS WebView).
        setOffset(diff > 60 ? diff : estimateKeyboardHeight());
      }, 350);
    };

    const onFocusOut = () => {
      setTimeout(() => setOffset(0), 100);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return offset;
}
