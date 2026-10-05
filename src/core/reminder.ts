import type { InfoEntry, ReminderPrefs } from './models';

/** 提醒窗口：随当日进度推进，起点越晚、最低完成度要求越高 */
export interface ReminderWindow { id: string; label: string; startsAt: number; minProgress: number; }

/** 提醒判定结果，驱动顶部横幅与浏览器通知 */
export interface ReminderStatus {
  due: boolean;
  phase: ReminderWindow | null;
  todayMinutes: number;
  progress: number;
  lastLogAt: Date | null;
  message: string;
}

export const REMINDER_WINDOWS: ReminderWindow[] = [
  { id: 'morning', label: '上午', startsAt: 9 * 60, minProgress: 0.15 },
  { id: 'midday', label: '午后', startsAt: 13 * 60, minProgress: 0.35 },
  { id: 'afternoon', label: '下午', startsAt: 16 * 60, minProgress: 0.6 },
  { id: 'evening', label: '晚间', startsAt: 19 * 60, minProgress: 0.85 },
];

const END_OF_DAY = 23 * 60 + 30;

/** 本地日期键 YYYY-MM-DD，避免 toISOString 的 UTC 偏移 */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 当前所处的提醒时段；23:30 后不再提醒 */
export function currentWindow(now: Date = new Date()): ReminderWindow | null {
  const mins = minutesOfDay(now);
  if (mins < REMINDER_WINDOWS[0].startsAt || mins >= END_OF_DAY) return null;
  let active: ReminderWindow = REMINDER_WINDOWS[0];
  for (const win of REMINDER_WINDOWS) {
    if (mins >= win.startsAt) active = win;
  }
  return active;
}

function todayEntries(entries: InfoEntry[], today: string): InfoEntry[] {
  return entries.filter((entry) => entry.date === today);
}

/** 最近一次记录时间：优先 createdAt，缺失时回退到当天日期本身 */
export function latestLogAt(entries: InfoEntry[], today: string): Date | null {
  const todays = todayEntries(entries, today);
  let latest: Date | null = null;
  for (const entry of todays) {
    const at = entry.createdAt ? new Date(entry.createdAt) : new Date(`${entry.date}T00:00:00`);
    if (!Number.isNaN(at.getTime()) && (!latest || at > latest)) latest = at;
  }
  return latest;
}

/** 纯函数计算提醒状态：目标完成 / 未进入提醒时段均不提醒 */
export function evaluateReminder(
  entries: InfoEntry[],
  dailyGoal: number,
  prefs: ReminderPrefs | undefined,
  now: Date = new Date(),
): ReminderStatus {
  const today = localDateKey(now);
  const todays = todayEntries(entries, today);
  const todayMinutes = todays.reduce((sum, entry) => sum + entry.minutes, 0);
  const progress = dailyGoal > 0 ? todayMinutes / dailyGoal : 1;
  const win = currentWindow(now);
  const lastLogAt = latestLogAt(entries, today);

  const done = progress >= 1;
  const behind = !!win && progress < win.minProgress;
  // 用户当天主动关闭后不再打扰；跨天 dismissedOn 与 today 不等，自动恢复
  const dismissed = prefs?.dismissedOn === today;
  const due = !done && behind && !dismissed;

  let message = '';
  if (due && win) {
    const gap = Math.max(dailyGoal - todayMinutes, Math.round(win.minProgress * dailyGoal - todayMinutes));
    const timeHint = lastLogAt
      ? `距离上次记录已过去 ${Math.round((now.getTime() - lastLogAt.getTime()) / 60000)} 分钟`
      : '今天还没有任何记录';
    message = `今天已摄入 ${todayMinutes}/${dailyGoal} 分钟（${Math.round(progress * 100)}%），${timeHint}。${win.label}目标至少完成 ${Math.round(win.minProgress * 100)}%，再补充约 ${gap} 分钟吧。`;
  }

  return { due, phase: win, todayMinutes, progress, lastLogAt, message };
}

/** 记录一次摄入后调用：若已重新达标则清掉当日关闭标记，让状态彻底回到最新完成度 */
export function reconcilePrefsAfterLog(
  prefs: ReminderPrefs | undefined,
  entries: InfoEntry[],
  dailyGoal: number,
  now: Date = new Date(),
): ReminderPrefs {
  const next: ReminderPrefs = { browserEnabled: prefs?.browserEnabled ?? false, ...prefs };
  const status = evaluateReminder(entries, dailyGoal, { ...next, dismissedOn: undefined }, now);
  if (status.progress >= 1) {
    next.dismissedOn = undefined;
    next.notifiedWindows = [];
  }
  return next;
}

/** 判断当前时段的浏览器通知是否尚未推送过（每时段最多一次，刷新不重弹） */
export function shouldNotify(status: ReminderStatus, prefs: ReminderPrefs | undefined): boolean {
  if (!status.due || !status.phase || !prefs?.browserEnabled) return false;
  const key = `${localDateKey()}#${status.phase.id}`;
  return !(prefs.notifiedWindows ?? []).includes(key);
}

/** 记录某时段通知已推送（只保留当天的时段标记，跨天自动清空） */
export function markNotified(prefs: ReminderPrefs | undefined, windowId: string): ReminderPrefs {
  const today = localDateKey();
  const todays = (prefs?.notifiedWindows ?? []).filter((item) => item.startsWith(`${today}#`));
  const key = `${today}#${windowId}`;
  return { ...(prefs ?? {}), notifiedWindows: todays.includes(key) ? todays : [...todays, key] };
}
