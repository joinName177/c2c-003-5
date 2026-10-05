export interface NotificationPort {
  readonly supported: boolean;
  permission(): NotificationPermission | 'unsupported';
  /** 请求授权；不支持或被拒绝时返回 denied */
  request(): Promise<NotificationPermission | 'unsupported'>;
  show(title: string, body: string): void;
}
