import type { ReminderPreferences, ReminderPreferencesRepository } from '../ports/reminder-preferences.port';

const KEY = 'c2c-003-reminder-preferences';

function freshDay(date: string) {
  return { date, dismissed: false, notifiedWindows: [] as string[] };
}

export class LocalReminderPreferencesRepository implements ReminderPreferencesRepository {
  load(todayDate: string): ReminderPreferences {
    let preferences: ReminderPreferences | undefined;
    try {
      const value = localStorage.getItem(KEY);
      if (value) preferences = JSON.parse(value) as ReminderPreferences;
    } catch {
      preferences = undefined;
    }
    if (!preferences) return { browserEnabled: false, day: freshDay(todayDate) };
    // 跨天（或首次使用）重置当天状态，授权偏好保留。
    if (preferences.day?.date !== todayDate) preferences.day = freshDay(todayDate);
    preferences.day.notifiedWindows = preferences.day.notifiedWindows || [];
    return preferences;
  }

  save(preferences: ReminderPreferences) {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  }
}
