import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { InfoEntry, ReminderPrefs } from '../core/models';
import { evaluateReminder, markNotified, shouldNotify } from '../core/reminder';
import type { NotificationPort } from '../ports/notification.port';

/**
 * 摄入提醒调度：
 * - 每 60 秒重算一次，跨提醒时段 / 跨天自动推进
 * - 页面重新可见（切回标签页、重开应用）时立即重算
 * - 浏览器通知每时段最多一次；刷新、重开不重复弹
 */
export function useReminder(
  entries: Ref<InfoEntry[]>,
  dailyGoal: Ref<number>,
  prefs: Ref<ReminderPrefs | undefined>,
  notifier: NotificationPort,
  onPrefsChange: (next: ReminderPrefs) => void,
) {
  const now = ref(new Date());
  let timer: number | undefined;

  const status = computed(() => evaluateReminder(entries.value, dailyGoal.value, prefs.value, now.value));

  function syncNotification() {
    if (!shouldNotify(status.value, prefs.value) || !status.value.phase) return;
    notifier.show('信息摄入提醒', status.value.message);
    onPrefsChange(markNotified(prefs.value, status.value.phase.id));
  }

  function tick() { now.value = new Date(); }

  watch(status, syncNotification);

  onMounted(() => {
    timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    // 首次挂载也尝试一次（重开应用时的初始评估）
    syncNotification();
  });

  function onVisibility() {
    if (document.visibilityState === 'visible') tick();
  }

  onBeforeUnmount(() => {
    if (timer) window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  });

  async function enableBrowserNotifications(): Promise<'granted' | 'denied' | 'unsupported'> {
    const result = await notifier.request();
    if (result === 'unsupported') return 'unsupported';
    if (result === 'granted') {
      onPrefsChange({ ...(prefs.value ?? {}), browserEnabled: true });
      syncNotification();
      return 'granted';
    }
    return 'denied';
  }

  function disableBrowserNotifications() {
    onPrefsChange({ ...(prefs.value ?? {}), browserEnabled: false });
  }

  /** 用户主动关闭顶部提醒：当日不再打扰（含浏览器通知），跨天自动恢复 */
  function dismissToday() {
    const today = `${now.value.getFullYear()}-${String(now.value.getMonth() + 1).padStart(2, '0')}-${String(now.value.getDate()).padStart(2, '0')}`;
    onPrefsChange({ ...(prefs.value ?? {}), dismissedOn: today });
  }

  return {
    status,
    notificationSupported: notifier.supported,
    notificationPermission: () => notifier.permission(),
    enableBrowserNotifications,
    disableBrowserNotifications,
    dismissToday,
  };
}
