<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { LocalRecipeRepository } from '../adapters/local-recipe.repository';
import { LocalReminderPreferencesRepository } from '../adapters/local-reminder-preferences.repository';
import { BrowserReminderNotifier } from '../adapters/browser-reminder.notifier';
import { NUTRITION, NUTRITION_META, SOURCES, type NutritionType, type SourceType } from '../core/models';
import { createEntry, diagnoses, mealScore, metricsFor, sampleSnapshot } from '../core/recipe-engine';
import { evaluateReminder } from '../core/reminder';
import { dateKey } from '../core/time';

const repo = new LocalRecipeRepository();
const reminderPrefsRepo = new LocalReminderPreferencesRepository();
const notifier = new BrowserReminderNotifier();

const state = reactive(repo.load());
const now = ref(Date.now());
const prefs = reactive(reminderPrefsRepo.load(dateKey(new Date(now.value))));
const tab = ref<'餐盘' | '摄入' | '检测' | '方案' | '报告'>('餐盘');
const notice = ref('');
const draft = reactive({ title: '', source: '文章' as SourceType, nutrition: '深度知识' as NutritionType, minutes: 20, note: '' });

const metrics = computed(() => metricsFor(state.entries));
const score = computed(() => mealScore(metrics.value));
const findings = computed(() => diagnoses(metrics.value));
const recent = computed(() => [...state.entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7));
const totalMinutes = computed(() => state.entries.reduce((sum, item) => sum + item.minutes, 0));

// 今天的目标完成度：提醒与顶部进度都只看当天记录。
const todayDate = computed(() => dateKey(new Date(now.value)));
const todayEntries = computed(() => state.entries.filter((item) => item.date === todayDate.value));
const todayMinutes = computed(() => todayEntries.value.reduce((sum, item) => sum + item.minutes, 0));
const todayCompletion = computed(() => Math.min(1, todayMinutes.value / Math.max(1, state.dailyGoal)));

// 提醒状态完全由当天数据派生：新增/删除记录、目标变化、时间推移都会即时重算，
// 不会停留在旧的完成度上。
const reminder = computed(() => evaluateReminder({
  entries: state.entries,
  dailyGoal: state.dailyGoal,
  todayDate: todayDate.value,
  now: now.value,
}));
// 用户主动关闭后，当天剩余时间不再出现横幅或通知（prefs 按日期持久化）。
const showReminder = computed(() => reminder.value.status === 'due' && !prefs.day.dismissed);

function save() { repo.save({ entries: state.entries, dailyGoal: state.dailyGoal }); }
function savePrefs() { reminderPrefsRepo.save({ browserEnabled: prefs.browserEnabled, day: { ...prefs.day, notifiedWindows: [...prefs.day.notifiedWindows] } }); }

// 跨天自动重置：新的一天关闭状态与已通知标记全部清空。
watch(todayDate, (date) => {
  if (prefs.day.date !== date) Object.assign(prefs, reminderPrefsRepo.load(date));
});

// 进入某提醒时段且确实该提醒时，浏览器通知只发一次（刷新/重开不会重复弹）。
const dueWindowKey = computed(() => (showReminder.value ? reminder.value.window?.key : undefined));
watch(dueWindowKey, () => pushDueNotification(), { immediate: true });

function pushDueNotification() {
  const key = dueWindowKey.value;
  if (!key || !prefs.browserEnabled) return;
  if (prefs.day.notifiedWindows.includes(key)) return;
  notifier.notify({
    title: reminder.value.title,
    body: reminder.value.body,
    onClick: () => { tab.value = '摄入'; },
  });
  // 已进入通知流程就记下时段：无论是否授权成功，刷新后都不会就同一时段反复请求。
  prefs.day.notifiedWindows.push(key);
  savePrefs();
}

async function toggleBrowserNotifications() {
  if (prefs.browserEnabled) {
    prefs.browserEnabled = false;
    savePrefs();
    return;
  }
  prefs.browserEnabled = true;
  savePrefs();
  const permission = await notifier.requestPermission();
  if (permission === 'granted') pushDueNotification();
}

function dismissReminder() {
  prefs.day.dismissed = true;
  savePrefs();
}

function goRecord() { tab.value = '摄入'; }

function addEntry() {
  state.entries.unshift(createEntry(draft.title, draft.source, draft.nutrition, draft.minutes, draft.note));
  save();
  draft.title = '';
  draft.note = '';
  notice.value = '摄入已记录，今日进度与提醒已重新计算';
  tab.value = '餐盘';
}
function removeEntry(id: string) { state.entries = state.entries.filter((item) => item.id !== id); save(); }
function reset() {
  const fresh = sampleSnapshot();
  state.entries = fresh.entries;
  state.dailyGoal = fresh.dailyGoal;
  save();
  Object.assign(prefs.day, { date: todayDate.value, dismissed: false, notifiedWindows: [] });
  savePrefs();
  notice.value = '已恢复初始示例餐盘';
}

// 每 30 秒校准时间，驱动时段切换、安静期结束与跨天重置；页面重新可见时立即校准。
let timer: number | undefined;
function syncNow() { now.value = Date.now(); }
onMounted(() => {
  timer = window.setInterval(syncNow, 30_000);
  document.addEventListener('visibilitychange', syncNow);
});
onUnmounted(() => {
  if (timer) window.clearInterval(timer);
  document.removeEventListener('visibilitychange', syncNow);
});
</script>

<template>
  <div class="recipe-app"><header class="recipe-topbar"><div class="recipe-brand"><span class="recipe-mark">食</span><div><span class="eyebrow">ATTENTION KITCHEN / 03</span><h1>信息食谱调配师</h1></div></div><div class="recipe-actions"><span>今日已摄入 <b>{{ todayMinutes }}</b> min</span><button type="button" class="notify-toggle" :class="{ on: prefs.browserEnabled }" :title="notifier.supported ? (prefs.browserEnabled ? '关闭浏览器摄入提醒' : '开启浏览器摄入提醒') : '当前浏览器不支持系统通知'" :disabled="!notifier.supported" @click="toggleBrowserNotifications">{{ prefs.browserEnabled ? '通知已开' : '开启通知' }}</button><button type="button" @click="reset">重置演示</button></div></header>
    <div v-if="showReminder" class="intake-reminder" role="alert"><span class="reminder-icon">!</span><div class="reminder-copy"><strong>{{ reminder.title }}</strong><p>{{ reminder.body }}</p></div><div class="reminder-actions"><button type="button" class="reminder-record" @click="goRecord">去记录</button><button type="button" class="reminder-dismiss" @click="dismissReminder">今天不再提醒</button></div></div>
    <main class="recipe-wrap"><section class="recipe-hero"><div><span class="eyebrow coral-text">YOUR DAILY INFORMATION DIET</span><h2>今天，给大脑<br /><em>配一份好食谱。</em></h2><p>信息也有营养密度。记录、咀嚼，再决定下一口要吃什么。</p></div><div class="daily-goal"><span>每日建议摄入</span><strong>{{ state.dailyGoal }}<small>min</small></strong><div><i :style="{ width: `${todayCompletion * 100}%` }"></i></div><small>{{ Math.round(todayCompletion * 100) }}% 完成</small></div></section><nav class="recipe-tabs"><button v-for="item in ['餐盘', '摄入', '检测', '方案', '报告']" :key="item" type="button" :class="{ active: tab === item }" @click="tab = item as typeof tab">{{ item }}</button></nav>
      <section v-if="tab === '餐盘'" class="plate-layout"><article class="plate-panel"><div class="section-heading"><div><span class="eyebrow">TODAY'S PLATE</span><h3>今日信息餐盘</h3></div><span class="score-chip">营养均衡度 {{ score }}</span></div><div class="pyramid"><div class="pyramid-level level-1"><span>深度知识</span><b>{{ Math.round((metrics[0]?.share || 0) * 100) }}%</b></div><div class="pyramid-level level-2"><span>行业动态</span><span>技能提升</span></div><div class="pyramid-level level-3"><span>娱乐消遣</span><span>社交信息</span></div></div><div class="pyramid-note"><span>信息营养金字塔</span><p>底层是每天应该稳定摄入的深度内容，上层是有意识调味的轻内容。</p></div></article><aside class="plate-side"><div class="side-card"><span class="eyebrow">NUTRIENT SNAPSHOT</span><h4>营养快照</h4><div v-for="item in metrics" :key="item.nutrition" class="nutrient-row"><div><i :style="{ background: item.color }"></i><span>{{ item.nutrition }}</span></div><strong>{{ item.minutes }}<small>min</small></strong></div></div><div class="side-card insight-card"><span class="eyebrow">KITCHEN NOTE</span><p>“{{ findings[0] }}”</p><button type="button" @click="tab = '检测'">查看完整检测 →</button></div></aside></section>
      <section v-else-if="tab === '摄入'" class="intake-layout"><article class="intake-form"><div class="section-heading"><div><span class="eyebrow">ADD TO THE PLATE</span><h3>记录一次信息摄入</h3></div><span class="section-number">01 / 05</span></div><label>内容标题<input v-model="draft.title" placeholder="例如：一篇关于城市设计的文章" /></label><label>内容形式<select v-model="draft.source"><option v-for="source in SOURCES" :key="source" :value="source">{{ source }}</option></select></label><label>营养类别<select v-model="draft.nutrition"><option v-for="nutrition in NUTRITION" :key="nutrition" :value="nutrition">{{ nutrition }} · {{ NUTRITION_META[nutrition].hint }}</option></select></label><label>消费时长 <output>{{ draft.minutes }} 分钟</output><input v-model.number="draft.minutes" type="range" min="5" max="180" step="5" /></label><label>备注（可选）<textarea v-model="draft.note" rows="3" placeholder="它给你带来了什么？"></textarea></label><button class="coral-button" type="button" @click="addEntry">加入今日餐盘 →</button><p class="notice">{{ notice }}</p></article><article class="intake-list"><div class="section-heading"><div><span class="eyebrow">RECENT BITES</span><h3>最近摄入</h3></div><span class="section-number">{{ state.entries.length }} 条</span></div><div class="bite-list"><div v-for="item in recent" :key="item.id" class="bite-row"><div class="bite-icon" :style="{ background: NUTRITION_META[item.nutrition].color }">{{ NUTRITION_META[item.nutrition].icon }}</div><div><strong>{{ item.title }}</strong><span>{{ item.source }} · {{ item.nutrition }} · {{ item.date }}</span></div><b>{{ item.minutes }}′</b><button type="button" title="删除记录" @click="removeEntry(item.id)">×</button></div></div></article></section>
      <section v-else-if="tab === '检测'" class="diagnosis-layout"><article class="diagnosis-main"><div class="section-heading"><div><span class="eyebrow">DIET DIAGNOSIS</span><h3>你的信息偏食检测</h3></div><span class="score-chip">{{ score }} / 100</span></div><div class="diagnosis-list"><div v-for="(item, index) in findings" :key="item" class="diagnosis-item"><span>0{{ index + 1 }}</span><div><strong>{{ item.includes('偏高') ? '摄入偏高' : item.includes('偏少') ? '长期缺失' : '整体平衡' }}</strong><p>{{ item }}</p></div><i>{{ item.includes('整体') ? '✓' : '!' }}</i></div></div></article><aside class="radar-card"><span class="eyebrow">BALANCE RADAR</span><h4>营养平衡雷达</h4><div class="radar-bars"><div v-for="item in metrics" :key="item.nutrition"><span>{{ item.nutrition }}</span><div><i :style="{ width: `${Math.min(100, item.share / item.target * 100)}%`, background: item.color }"></i></div><small>{{ Math.round(item.share * 100) }}%</small></div></div></aside></section>
      <section v-else-if="tab === '方案'" class="recipe-plan"><div class="section-heading"><div><span class="eyebrow">OPTIMIZED INFORMATION RECIPE</span><h3>下一周的信息食谱</h3></div><span class="section-number">基于最近 7 天</span></div><div class="meal-plan"><div v-for="(item, index) in metrics" :key="item.nutrition" class="meal-item"><span class="meal-time">{{ ['早餐', '上午茶', '午餐', '下午茶', '晚餐'][index] || '加餐' }}</span><div class="meal-color" :style="{ background: item.color }">{{ item.icon }}</div><div><strong>补充 {{ item.nutrition }}</strong><p>{{ item.nutrition === '深度知识' ? '找一篇能让你停下来做笔记的长文。' : item.nutrition === '技能提升' ? '把一个概念变成一次小练习。' : item.nutrition === '行业动态' ? '只选一个可信来源，了解发生了什么。' : item.nutrition === '娱乐消遣' ? '选择能真正让你恢复的轻内容。' : '发一条消息，认真回应一个人。' }}</p></div><span class="meal-duration">{{ Math.max(15, Math.round(item.target * state.dailyGoal)) }} min</span></div></div></section>
      <section v-else class="report-page"><div class="report-head"><span class="eyebrow">WEEKLY INTAKE REPORT · W40</span><h3>你的信息摄入报告</h3><p>信息不是越多越好，而是要吃得刚刚好。</p></div><div class="report-metrics"><div><span>总摄入</span><strong>{{ totalMinutes }}<small>min</small></strong></div><div><span>均衡度</span><strong>{{ score }}<small>/ 100</small></strong></div><div><span>最常摄入</span><strong>{{ metrics.slice().sort((a,b) => b.minutes-a.minutes)[0]?.nutrition }}</strong></div></div><div class="report-bars"><div v-for="item in metrics" :key="item.nutrition" class="report-bar"><div><span>{{ item.nutrition }}</span><b>{{ item.minutes }} min</b></div><div><i :style="{ width: `${Math.max(4, item.share * 100)}%`, background: item.color }"></i><em :style="{ left: `${item.target * 100}%` }"></em></div><small>建议 {{ Math.round(item.target * 100) }}%</small></div></div></section>
    </main></div>
</template>
