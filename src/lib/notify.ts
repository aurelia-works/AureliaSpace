import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (granted !== null) return granted;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
  return granted;
}

export async function notify(title: string, body: string) {
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* notifications are best-effort */
  }
}

export function primeNotifications() {
  void ensurePermission();
}
