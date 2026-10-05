import assert from 'node:assert';
import { evaluateReminder, REMINDER_WINDOWS } from '../src/core/reminder';
import { createEntry } from '../src/core/recipe-engine';
import { dateKey } from '../src/core/time';
import type { InfoEntry } from '../src/core/models';

const date = '2026-10-05';
const at = (h: number, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
const mk = (minutes: number, createdAt: number, title = 't'): InfoEntry => createEntry(title, '文章', '深度知识', minutes, '', date, createdAt);

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log('✓', name); }

// 1. 非提醒时段：空闲
check('非提醒时段不提醒', () => {
  const r = evaluateReminder({ entries: [], dailyGoal: 150, todayDate: date, now: at(9) });
  assert.equal(r.status, 'idle');
  assert.equal(r.reason, 'outside-reminder-hours');
});

// 2. 午间窗口，零摄入 → due
check('午间零摄入应提醒', () => {
  const r = evaluateReminder({ entries: [], dailyGoal: 150, todayDate: date, now: at(12) });
  assert.equal(r.status, 'due');
  assert.equal(r.window?.key, 'midday');
  assert.ok(r.title.includes('还没有摄入记录'));
});

// 3. 午间进度 >= 30% → 不提醒
check('午间进度达标不提醒', () => {
  const r = evaluateReminder({ entries: [mk(50, at(11))], dailyGoal: 150, todayDate: date, now: at(12) });
  assert.equal(r.status, 'idle');
  assert.equal(r.reason, 'progress-ok-for-window');
});

// 4. 傍晚阈值 60%：45/150=30% 仍 due，且安静期（180min）过后
check('傍晚进度不足提醒且时段阈值随进度抬高', () => {
  const r = evaluateReminder({ entries: [mk(45, at(11))], dailyGoal: 150, todayDate: date, now: at(17, 30) });
  assert.equal(r.status, 'due');
  assert.equal(r.window?.key, 'evening');
});

// 5. 最近记录在安静时长内 → idle
check('刚记录过保持安静', () => {
  const r = evaluateReminder({ entries: [mk(10, at(16, 40))], dailyGoal: 150, todayDate: date, now: at(17, 30) });
  assert.equal(r.status, 'idle');
  assert.equal(r.reason, 'recently-recorded');
  assert.ok(r.quietUntil! > at(17, 30));
});

// 6. 安静期结束后自动转为 due（同一份数据，时间推移）
check('安静期结束后重新提醒', () => {
  const entries = [mk(10, at(16, 40))];
  const before = evaluateReminder({ entries, dailyGoal: 150, todayDate: date, now: at(17, 30) });
  const after = evaluateReminder({ entries, dailyGoal: 150, todayDate: date, now: at(20, 45) });
  assert.equal(before.status, 'idle');
  assert.equal(after.status, 'due');
  assert.equal(after.window?.key, 'night');
});

// 7. 完成每日目标 → done，任何时段都不再提醒
check('目标完成后不再提醒', () => {
  for (const h of [12, 18, 22]) {
    const r = evaluateReminder({ entries: [mk(150, at(8))], dailyGoal: 150, todayDate: date, now: at(h) });
    assert.equal(r.status, 'done', `hour ${h}`);
  }
});

// 8. 记录一次后完成度重新计算（派生数据，非缓存）：10→95 仍不足，再加 60 完成
check('新增记录即时重算完成度', () => {
  const entries: InfoEntry[] = [mk(10, at(16))];
  const low = evaluateReminder({ entries, dailyGoal: 150, todayDate: date, now: at(21) });
  assert.equal(low.status, 'due');
  entries.push(mk(85, at(21, 5), '二'));
  entries.push(mk(60, at(21, 6), '三'));
  const done = evaluateReminder({ entries, dailyGoal: 150, todayDate: date, now: at(21, 10) });
  assert.equal(done.status, 'done');
  assert.equal(done.todayMinutes, 155);
});

// 9. 昨天的记录不计入今天
check('跨天记录不计入今日', () => {
  const y = createEntry('旧', '文章', '深度知识', 150, '', '2026-10-04', at(20) - 86400000);
  const r = evaluateReminder({ entries: [y], dailyGoal: 150, todayDate: date, now: at(12) });
  assert.equal(r.status, 'due');
  assert.equal(r.todayMinutes, 0);
});

// 10. 旧数据没有 createdAt：不会被误判为刚刚记录（按当天 23:59 兜底，等于 now 上限）
check('无时间戳的旧记录不享受安静期误判', () => {
  const old: any = { id: 'x', title: '旧', source: '文章', nutrition: '深度知识', minutes: 10, date, note: '' };
  const r = evaluateReminder({ entries: [old as InfoEntry], dailyGoal: 150, todayDate: date, now: at(12) });
  assert.equal(r.status, 'due');
});

// 11. dateKey 本地时区
check('dateKey 格式正确', () => assert.match(dateKey(new Date(at(12))), /^\d{4}-\d{2}-\d{2}$/));

// 12. 三个时段配置存在且阈值递增
check('提醒时段阈值随当日进度递增', () => {
  const ratios = REMINDER_WINDOWS.map((w) => w.ratio);
  assert.deepEqual(ratios, [0.3, 0.6, 0.8]);
});

console.log(`\n${passed} 项全部通过`);
