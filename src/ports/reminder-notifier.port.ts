export interface ReminderNotification {
  title: string;
  body: string;
  onClick?: () => void;
}

export interface ReminderNotifier {
  readonly supported: boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  notify(notification: ReminderNotification): void;
}
