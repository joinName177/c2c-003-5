import type { ReminderNotification, ReminderNotifier } from '../ports/reminder-notifier.port';

// 浏览器原生通知适配器。页面不可见时才推送（可见时顶部横幅已在提醒），
// 点击通知会唤回标签页并跳到记录入口。
export class BrowserReminderNotifier implements ReminderNotifier {
  get supported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  permission(): NotificationPermission {
    return this.supported ? Notification.permission : 'denied';
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.supported) return 'denied';
    if (Notification.permission === 'default') {
      try {
        return await Notification.requestPermission();
      } catch {
        return Notification.permission;
      }
    }
    return Notification.permission;
  }

  notify({ title, body, onClick }: ReminderNotification): void {
    if (!this.supported || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    const notification = new Notification(title, { body, tag: 'c2c-003-intake-reminder' });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  }
}
