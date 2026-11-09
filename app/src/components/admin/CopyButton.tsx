"use client";

import { useState } from "react";
import { buttonCls } from "./ui";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonCls.lime}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      <span aria-live="polite">{done ? "복사함" : label}</span>
    </button>
  );
}
