"use client";

import { useState, useEffect } from "react";

/**
 * Tracks the virtual keyboard height using the visualViewport API.
 * Returns the keyboard height in pixels (0 when keyboard is hidden).
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function onResize() {
      if (!vv) return;
      // The keyboard height is the difference between window inner height and visual viewport height
      const kbHeight = window.innerHeight - vv.height;
      setKeyboardHeight(kbHeight > 0 ? kbHeight : 0);
    }

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  return keyboardHeight;
}
