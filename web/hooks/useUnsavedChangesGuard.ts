"use client";

import { useCallback, useEffect } from "react";

export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "保存されていない興味トピックの変更があります。保存せずに移動しますか？",
    );
  }, [isDirty]);

  return { confirmDiscardIfDirty };
}
