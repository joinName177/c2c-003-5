// 摄入提醒：纯函数领域逻辑，不接触浏览器 API，便于测试。
// 提醒时段随当日进度变化，并参考最近一次记录时间，避免对刚刚记录过的人重复打扰。
import type { InfoEntry } from './models';

export interface ReminderWindow {
  key: string;
  label: string;
  startHour: number; // 含，小时（24 小时制，可带小数，如 11.5 = 11:30）
  endHour: number; // 不含
  ratio: number; // 到此时段，今日目标完成比例低于该值才算“明显不足”
  quietMinutes: number; // 最近一次记录距现在不足该时长则保持安静
}

// 时段阈值随一天推进而抬高：越晚离目标越远，越值得提醒。
export const REMINDER_WINDOWS: ReminderWindow[] = [
  { key: 'midday', label: '午间', startHour: 11.5, endHour: 14, ratio: 0.3, quietMinutes: 90 },
  { key: 'evening', label: '傍晚', startHour: 17, endHour: 19, ratio: 0.6, quietMinutes: 180 },
  { key: 'night', label: '夜间', startHour: 20.5, endHour: 23, ratio: 0.8, quietMinutes: 180 },
];

export type ReminderStatus = 'idle' | 'due' | 'done';

export interface ReminderEvaluation {
  status: ReminderStatus;
  window?: ReminderWindow;
  reason: string;
  todayMinutes: number;
  goalMinutes: number;
  completion: number; // 0..1
  lastRecordAt?: number;
  quietUntil?: number; // 最近一次记录后保持安静的截止时间戳
  title: string;
  body: string;
}

export interface ReminderInput {
  entries: InfoEntry[];
  dailyGoal: number;
  todayDate: string; // 本地日期 YYYY-MM-DD
  now: number; // 当前时间戳（毫秒）
}

export function currentWindow(now: Date = new Date()): ReminderWindow | undefined {
  const hour = now.getHours() + now.getMinutes() / 60;
  return REMINDER_WINDOWS.find((w) => hour >= w.startHour && hour < w.endHour);
}

export function todayEntries(entries: InfoEntry[], todayDate: string): InfoEntry[] {
  return entries.filter((entry) => entry.date === todayDate);
}

// 最近一次记录时间：新记录带 createdAt；旧数据没有时间戳时按当天 00:00 兜底，
// 即“时间未知、按很久以前处理”，不会误占安静期而压制提醒。
export function lastRecordTime(entries: InfoEntry[], todayDate: string, now: number): number | undefined {
  const times = todayEntries(entries, todayDate)
    .map((entry) => (typeof entry.createdAt === 'number' ? entry.createdAt : Date.parse(`${todayDate}T00:00:00`)))
    .filter((time) => !Number.isNaN(time));
  if (!times.length) return undefined;
  return Math.min(Math.max(...times), now);
}

function buildMessage(window: ReminderWindow, todayMinutes: number, goalMinutes: number, recorded: boolean): { title: string; body: string } {
  const gap = Math.max(1, Math.round(goalMinutes * window.ratio) - todayMinutes);
  const title = recorded
    ? `${window.label}还没继续记录摄入`
    : `${window.label}了，今天还没有摄入记录`;
  const body = recorded
    ? `今天已记录 ${todayMinutes} 分钟，距当前进度还差约 ${gap} 分钟，花几分钟补一条记录吧。`
    : `每日目标 ${goalMinutes} 分钟还是空的，先记录一条，哪怕只有几分钟。`;
  return { title, body };
}

export function evaluateReminder(input: ReminderInput): ReminderEvaluation {
  const { entries, dailyGoal, todayDate, now } = input;
  const todays = todayEntries(entries, todayDate);
  const todayMinutes = todays.reduce((sum, entry) => sum + entry.minutes, 0);
  const goalMinutes = Math.max(1, dailyGoal);
  const completion = Math.min(1, todayMinutes / goalMinutes);
  const base = { todayMinutes, goalMinutes, completion };
  const lastRecordAt = lastRecordTime(entries, todayDate, now);

  if (completion >= 1) {
    return { ...base, status: 'done', reason: 'today-goal-reached', lastRecordAt, title: '', body: '' };
  }

  const window = currentWindow(new Date(now));
  if (!window) {
    return { ...base, status: 'idle', reason: 'outside-reminder-hours', lastRecordAt, title: '', body: '' };
  }

  if (completion >= window.ratio) {
    return { ...base, status: 'idle', reason: 'progress-ok-for-window', window, lastRecordAt, title: '', body: '' };
  }

  if (lastRecordAt !== undefined) {
    const quietUntil = lastRecordAt + window.quietMinutes * 60_000;
    if (now < quietUntil) {
      return { ...base, status: 'idle', reason: 'recently-recorded', window, lastRecordAt, quietUntil, title: '', body: '' };
    }
  }

  const { title, body } = buildMessage(window, todayMinutes, goalMinutes, lastRecordAt !== undefined);
  return { ...base, status: 'due', reason: 'behind-daily-goal', window, lastRecordAt, title, body };
}
