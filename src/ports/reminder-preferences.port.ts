// 提醒状态仓储：当天主动关闭后不再打扰，且每个提醒时段最多通知一次。
// 状态按日期保存，跨天自动重新开始；浏览器通知授权则跨天保留。
export interface ReminderDayState {
  date: string; // 本地日期 YYYY-MM-DD
  dismissed: boolean; // 用户主动关闭当天提醒
  notifiedWindows: string[]; // 已通过浏览器通知的时段 key
}

export interface ReminderPreferences {
  browserEnabled: boolean; // 用户是否希望开启浏览器通知
  day: ReminderDayState;
}

export interface ReminderPreferencesRepository {
  load(todayDate: string): ReminderPreferences;
  save(preferences: ReminderPreferences): void;
}
