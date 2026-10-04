import { useUi } from "../store/ui";

export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.at} className={`toast${toast.error ? " error" : ""}`} onClick={() => useUi.getState().set({ toast: null })}>
      {toast.text}
    </div>
  );
}
