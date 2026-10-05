import type { NotificationPort } from '../ports/notification.port';

/** 基于浏览器 Notification API 的通知适配器；无权限时静默失败 */
export class BrowserNotificationAdapter implements NotificationPort {
  get supported(): boolean { return typeof window !== 'undefined' && 'Notification' in window; }

  permission(): NotificationPermission | 'unsupported' {
    return this.supported ? Notification.permission : 'unsupported';
  }

  async request(): Promise<NotificationPermission | 'unsupported'> {
    if (!this.supported) return 'unsupported';
    if (Notification.permission === 'default') {
      try { return await Notification.requestPermission(); } catch { return 'denied'; }
    }
    return Notification.permission;
  }

  show(title: string, body: string): void {
    if (!this.supported || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, tag: 'c2c-003-intake-reminder' }); } catch { /* 通知失败不影响顶部横幅 */ }
  }
}
