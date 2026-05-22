const STORAGE_KEY = 'ccremote:notifications';

export function notificationsEnabled(): boolean {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}

export function setNotificationsEnabled(on: boolean) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch {}
}
