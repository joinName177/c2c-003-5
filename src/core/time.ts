// 本地时区的日期工具。toISOString().slice(0,10) 在 UTC+8 的凌晨会得到“昨天”，
// 会让按日计算的目标完成度与提醒跨天重置出错，这里统一使用本地日期。
export function dateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 某本地日期中午的时间戳（用于构造示例数据，避免 UTC 换算串到前一天）。
export function noonOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00`).getTime();
}
