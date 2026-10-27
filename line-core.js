// 生產線 core, shared by factory.html (the planner) and plant.html (the plant map): the week's wish list, shop limits,
// the plan they allow and the schedule the stations run. Recipes, item sources and the board's gathering scrolls come
// from index.html, so every page reads one set of data. Exposed as window.LineCore.
(() => {
  // Production-line facts the board doesn't have:
  //   shop: { limit, resetDay, resetAt } — every shop sells each item at most `limit` per character per week, and the
  //     limits reset on `resetDay` (0 = Sunday) at `resetAt`, Taiwan time,
  //   skills: { skill: { equip, secs? } } — the station a recipe skill is made at, and a default time per batch
  //     (料理 is assembled at 食物製作台 in seconds, so it counts as 0),
  //   equipment: { station: { queue } } — how many batches can be lined up on a station (排程上限); a station makes one
  //     batch at a time, a finished batch keeps its place until 全部領取, and stations are shared by all characters,
  //   steps: { item: { equip?, secs? } } — an item's own station or time per batch, in seconds.
  // Anything not here shows as 待補. Values typed on the planner are kept only in the browser (暫填) until moved here.
  const LINE = {
    rev: 3,
    updated: '2026-10-25',
    shop: { limit: 30, resetDay: 1, resetAt: '06:30' },
    skills: {
      料理: { equip: '食物製作台', secs: 0 },
      食材加工: { equip: '食材加工設備' },
      金屬加工: { equip: '金屬加工設備' },
      木材加工: { equip: '木材加工設備' },
      皮革加工: { equip: '皮革加工設備' },
      布料加工: { equip: '布料加工設備' },
    },
    equipment: { 食材加工設備: { queue: 5 }, 木材加工設備: { queue: 5 }, 皮革加工設備: { queue: 5 } },
    steps: { 鮮奶油: { secs: 1500 }, 麵粉: { secs: 600 }, 高級木材: { secs: 4800 }, 高級皮革: { secs: 4800 } },
  };

  const CITIES = ['提爾克那', '杜巴頓', '庫漢', '班克爾'];
  const SKILLS = ['料理'];
  const SECTION_ORDER = ['簡便', '力量特化', '技巧特化', '智力特化', '共享'];
  const KEY = 'mm-line-v1';
  const COLORS = ['#e8b33a', '#5fa04e', '#4f7fc0', '#c9503a', '#9a6bc0', '#e07a9a', '#3aa3a0', '#b07440'];
  const SHOP = Object.assign({ limit: 30, resetDay: 1, resetAt: '06:30' }, LINE.shop);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('zh-TW');
  const posInt = (v) => { const n = Math.floor(Number(v)); return n > 0 ? n : null; };
  const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  /* ---------- time ---------- */
  const fmtDur = (s) => {
    s = Math.round(s || 0);
    if (s <= 0) return '0 分';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return [d && `${d}天`, h && `${h}小時`, m && `${m}分`, x && `${x}秒`].filter(Boolean).join('');
  };
  const clock = (s) => {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  };
  // "1:20" is 1 hour 20 minutes, a bare number is minutes, and units can be spelled out: 1小時20分, 30秒, 2h, 45m.
  const UNIT = { 天: 86400, d: 86400, 小時: 3600, 時: 3600, h: 3600, 分鐘: 60, 分: 60, m: 60, 秒: 1, s: 1 };
  const parseDur = (v) => {
    const s = String(v ?? '').trim().replace(/：/g, ':').replace(/\s+/g, '');
    if (!s) return null;
    const hm = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60 + Number(hm[3] || 0);
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
    let total = 0, used = '';
    for (const [all, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(天|小時|分鐘|時|分|秒|[dhms])/gi)) { used += all; total += parseFloat(n) * UNIT[u.toLowerCase()]; }
    return used && used.length === s.length ? Math.round(total) : NaN;
  };
  // The shop week, from the last reset to the next, in Taiwan time (UTC+8).
  function shopWeek() {
    const TZ = 8 * 3600e3, DAY = 864e5, [hh, mm] = String(SHOP.resetAt).split(':').map(Number);
    const t = Date.now() + TZ, d = new Date(t);
    let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() - SHOP.resetDay + 7) % 7, hh || 0, mm || 0);
    if (start > t) start -= 7 * DAY;
    const end = start + 7 * DAY;
    const day = (ms) => { const x = new Date(ms); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}（${'日一二三四五六'[x.getUTCDay()]}）${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`; };
    return { start: start - TZ, range: `${day(start)} ～ ${day(end)}`, left: fmtDur(Math.floor((end - t) / 60e3) * 60) };
  }

  /* ---------- saved state, shared by the pages ---------- */
  // orders: the week's wish list, top first ({ dish, qty }); chars: how many characters buy (0 = the board's count);
  // have: the stock in hand now, as the game's bag shows it, by item; draft: station, time and queue values typed on the
  // planner.
  const SAVED = readLS(KEY);
  const S = Object.assign({ orders: [], chars: 0, have: {}, speed: 0, draft: { steps: {}, queue: {} } }, SAVED || {});
  if (!Array.isArray(S.orders)) S.orders = [];
  // Older saves planned one dish ({ dish, qty }); it becomes the first line of the list.
  if (!S.orders.length && S.dish) S.orders.push({ dish: S.dish, qty: S.qty });
  delete S.dish; delete S.qty;
  S.orders = S.orders.filter((o) => o && typeof o.dish === 'string').map((o) => ({ dish: o.dish, qty: posInt(o.qty) || 1 }));
  if (!S.have || typeof S.have !== 'object') S.have = {};
  if (!S.draft || typeof S.draft !== 'object') S.draft = {};
  if (!S.draft.steps || typeof S.draft.steps !== 'object') S.draft.steps = {};
  // Older drafts called the queue "slots" (when stations were thought to run batches side by side).
  if (!S.draft.queue || typeof S.draft.queue !== 'object') S.draft.queue = S.draft.slots && typeof S.draft.slots === 'object' ? S.draft.slots : {};
  delete S.draft.slots;
  // done: this week's actual progress, cleared when the shop week turns over (`week` is the week's start) —
  // bought ('who|town|item' → [count per character, first character first]), processed (made item → batches
  // finished), assembled (dish → made), proc (station → { order: the batches still to put in, by item, in the order
  // chosen; slots: the station's places, see slotsOf }). What is gathered isn't kept: it shows in the stock.
  const DONE_KINDS = ['bought', 'processed', 'assembled', 'proc'];
  if (!S.done || typeof S.done !== 'object') S.done = { week: 0 };
  for (const k of DONE_KINDS) if (!S.done[k] || typeof S.done[k] !== 'object') S.done[k] = {};
  delete S.done.gathered;
  // Purchases used to be one count per shop and item; that count becomes the first character's.
  for (const [k, v] of Object.entries(S.done.bought)) if (!Array.isArray(v)) S.done.bought[k] = [Math.max(0, Math.floor(Number(v)) || 0)];
  const save = () => writeLS(KEY, S);
  function rollWeek() {
    const week = shopWeek().start;
    if (S.done.week === week) return;
    S.done = { week, ...Object.fromEntries(DONE_KINDS.map((k) => [k, {}])) };
    save();
  }

  /* ---------- board data ---------- */
  const REC = new Map();     // item → { name, skill, yield, inputs, instant, … } — recipes plus 加工 notes
  const MATS = { items: {}, grades: {} };
  const GATHER = new Map();  // item → gathering skills from the board's scrolls
  let BOARD_CHARS = null;
  const yieldOf = (r) => Math.max(1, Math.floor(Number(r.yield)) || 1);
  const gradeOf = (name) => { const g = (REC.get(name) || {}).grade || MATS.grades[name] || ''; return g === '白' ? '' : g; };
  const nameHTML = (name) => { const g = gradeOf(name); return `<b class="${g ? `grade-${g}` : ''}">${esc(name)}</b>`; };

  async function load() {
    // Until a count is picked here, buy with as many characters as the board's 角色數.
    BOARD_CHARS = posInt((readLS('mm-board-progress-v1') || {}).chars);
    const res = await fetch('index.html', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const json = (id, fallback) => { try { return JSON.parse(doc.getElementById(id).textContent); } catch (_) { return fallback; } };
    const recipes = json('recipes', { items: [] });
    Object.assign(MATS, json('materials', {}));
    if (!MATS.grades || typeof MATS.grades !== 'object') MATS.grades = {};
    const catalog = json('catalog', { quests: [] });
    for (const r of recipes.items || []) if (r && r.name && Array.isArray(r.inputs)) REC.set(r.name, r);
    // A #materials note like "加工：小麥 ×15 → 麵粉 ×3" is a processing recipe the board hasn't made a card for.
    for (const [name, v] of Object.entries(MATS.items || {})) {
      if (REC.has(name)) continue;
      for (const s of [].concat(v)) {
        const m = String(s).match(/^加工[:：]\s*(.+?)\s*→\s*(.+?)\s*[×x]\s*(\d+)\s*$/);
        if (!m || m[2] !== name) continue;
        const inputs = m[1].split(/[、,，+＋]/).map((p) => p.trim().match(/^(.+?)\s*[×x]\s*(\d+)$/)).filter(Boolean).map((p) => ({ item: p[1], qty: Number(p[2]) }));
        if (inputs.length) REC.set(name, { name, skill: '加工', yield: Number(m[3]), inputs });
      }
    }
    for (const q of catalog.quests || []) {
      const name = (q.target || '').trim();
      if (!name || q.kind === '討伐' || !q.method || q.method === '料理') continue;
      if (!GATHER.has(name)) GATHER.set(name, []);
      if (!GATHER.get(name).includes(q.method)) GATHER.get(name).push(q.method);
    }
    // Wish-list lines whose dish no longer exists drop out; a first visit starts from the example the page was built
    // around.
    const names = new Set(dishes().map((r) => r.name));
    S.orders = S.orders.filter((o) => names.has(o.dish));
    rollWeek();
    if (!SAVED && !S.orders.length) {
      const cake = dishes().find((r) => r.name.includes('蛋糕'));
      if (cake) S.orders.push({ dish: cake.name, qty: 30 });
    }
  }
  const dishes = () => [...REC.values()].filter((r) => SKILLS.includes(r.skill) && r.product);
  const dishOptions = (picked) => {
    const list = dishes();
    return [...new Set([...SECTION_ORDER, ...list.map((r) => r.section || '其他')])].map((sec) => {
      const items = list.filter((r) => (r.section || '其他') === sec);
      return items.length ? `<optgroup label="${esc(sec)}">${items.map((r) => `<option${r.name === picked ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>` : '';
    }).join('');
  };

  // Ways to get a raw material: { kind: buy|barter|loot|gather, who, town, note, text }.
  const parseSource = (s) => {
    const m = String(s).match(/^(購買|以物易物|任務戰利品)・(.+)$/);
    if (m) {
      const p = m[2].match(/^(.+?)（(.+)）$/);
      const who = p ? p[1] : m[2], paren = p ? p[2] : '';
      const town = CITIES.includes(paren) ? paren : '';
      return { kind: { 購買: 'buy', 以物易物: 'barter', 任務戰利品: 'loot' }[m[1]], who, town, note: town ? '' : paren, text: s };
    }
    return { kind: 'gather', text: String(s) };
  };
  const sourcesOf = (name) => [
    ...(GATHER.get(name) || []).map((t) => ({ kind: 'gather', text: t })),
    ...[].concat(MATS.items[name] || []).filter((s) => !/^加工[:：]/.test(s)).map(parseSource),
  ];
  const sourceText = (s) => (s.kind === 'gather' ? s.text : `${{ buy: '購買', barter: '以物易物', loot: '任務戰利品' }[s.kind]}・${s.who}${s.town || s.note ? `（${s.town || s.note}）` : ''}`);
  const townRank = (t) => (CITIES.includes(t) ? CITIES.indexOf(t) : CITIES.length);

  /* ---------- the plan: how much of everything, in how many batches ---------- */
  // A made item's station, time per batch and the station's queue, each with where it came from (data / draft / none),
  // so the planner can mark 待補 and 暫填.
  function stepInfo(name) {
    const r = REC.get(name);
    const data = LINE.steps[name] || {}, draft = S.draft.steps[name] || {}, skill = LINE.skills[r.skill] || {};
    const equipData = data.equip ?? (r.instant ? '立即製作' : skill.equip ?? null);
    const secsData = data.secs ?? (r.instant ? 0 : skill.secs ?? null);
    const equip = draft.equip ?? equipData;
    const secs = draft.secs ?? secsData;
    const lane = equip || `${name}的設備`;
    const queueData = (LINE.equipment[lane] || {}).queue ?? null;
    const queue = S.draft.queue[lane] ?? queueData;
    const from = (d, v) => (d != null ? 'draft' : v != null ? 'data' : 'none');
    return {
      equip, secs, lane, queue, instant: !!r.instant,
      equipFrom: from(draft.equip, equipData), secsFrom: from(draft.secs, secsData), queueFrom: from(S.draft.queue[lane], queueData),
    };
  }
  // A step that takes no waiting: 立即製作, or assembly counted as 0.
  const quick = (s) => s.instant || s.secs === 0;

  // Everything under a dish, each listed after all the things that consume it (longest path from the dish).
  const CHAINS = new Map();
  function chain(dish) {
    if (CHAINS.has(dish)) return CHAINS.get(dish);
    const level = new Map();
    const visit = (name, lv, path) => {
      if (path.has(name) || (level.get(name) ?? -1) >= lv) return;
      level.set(name, lv);
      const r = REC.get(name);
      if (!r) return;
      path.add(name);
      for (const i of r.inputs) visit(i.item, lv + 1, path);
      path.delete(name);
    };
    visit(dish, 0, new Set());
    const list = [...level.keys()].sort((a, b) => level.get(a) - level.get(b));
    CHAINS.set(dish, list);
    return list;
  }

  // What n of a dish takes, drawing made items from `pool` (held or left over) first:
  // { raw: material → count, use: made item → taken from pool, net: made item → still to make,
  //   batches: made item → batches, left: made item → made beyond what this needs }.
  function expand(dish, n, pool) {
    const need = new Map([[dish, n]]);
    const out = { raw: new Map(), use: new Map(), net: new Map(), batches: new Map(), left: new Map() };
    for (const name of chain(dish)) {
      const q = need.get(name) || 0;
      if (!q) continue;
      const r = REC.get(name);
      if (!r) { out.raw.set(name, q); continue; }
      const take = name === dish ? 0 : Math.min(q, pool.get(name) || 0);
      if (take) out.use.set(name, take);
      const net = q - take;
      if (!net) continue;
      const b = Math.ceil(net / yieldOf(r));
      out.net.set(name, net);
      out.batches.set(name, b);
      if (b * yieldOf(r) > net) out.left.set(name, b * yieldOf(r) - net);
      for (const i of r.inputs) need.set(i.item, (need.get(i.item) || 0) + b * i.qty);
    }
    return out;
  }

  /* ---------- this week's allocation: shop limits shared out down the wish list ---------- */
  const MAX_CHARS = 6; // the game lets an account have at most this many characters
  const chars = () => Math.min(MAX_CHARS, posInt(S.chars) || BOARD_CHARS || 1);
  const charsFromBoard = () => !posInt(S.chars) && !!BOARD_CHARS;
  const held = (name) => Math.max(0, Math.floor(Number(S.have[name])) || 0);

  /* ---------- stock and this week's purchases ---------- */
  // The week's work moves the stock the way the game does: a purchase adds to it, a batch processed takes its inputs
  // and adds its output, a dish assembled takes its inputs. The plan works from base(): what would be in hand had none
  // of this week's processing or assembly happened, so the stock can be typed in from the game at any point.
  // A page may follow every move (onStock): the item, how much it really moved and why — { use: step } a step took (or
  // gave back) its inputs, { make: step } a step's output, { lane } a station's round given back, { buy: true }.
  let stockHook = null;
  const onStock = (fn) => { stockHook = fn; };
  const bump = (name, d, why = {}) => {
    const old = held(name), n = Math.max(0, old + Math.round(d));
    if (n) S.have[name] = n; else delete S.have[name];
    if (stockHook && n !== old) stockHook(name, n - old, why);
  };
  function worked(kind, name, d) {
    const r = REC.get(name);
    if (!r || !d) return;
    const per = kind === 'assembled' ? d / yieldOf(r) : d;
    for (const i of r.inputs) bump(i.item, -i.qty * per, { use: name });
    if (kind === 'processed') bump(name, yieldOf(r) * d, { make: name });
  }
  // What this week's finished batches, rounds still running and assembled dishes have taken (used) and made, by item.
  function usedThisWeek() {
    const used = new Map(), made = new Map(), add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
    for (const name of runningItems()) { const r = REC.get(name); if (r) for (const i of r.inputs) add(used, i.item, i.qty); }
    for (const kind of ['processed', 'assembled']) for (const [name, v] of Object.entries(S.done[kind])) {
      const r = REC.get(name), n = Math.max(0, Math.floor(Number(v)) || 0);
      if (!r || !n) continue;
      const per = kind === 'assembled' ? n / yieldOf(r) : n;
      for (const i of r.inputs) add(used, i.item, i.qty * per);
      if (kind === 'processed') add(made, name, yieldOf(r) * n);
    }
    return { used, made };
  }
  const baseOf = (name, U) => Math.max(0, Math.round(held(name) + (U.used.get(name) || 0) - (U.made.get(name) || 0)));
  // A purchase: key 'who|town|item', character c (0 = first); the stock moves by the difference.
  const boughtBy = (key) => (Array.isArray(S.done.bought[key]) ? S.done.bought[key] : []);
  function setBought(key, c, n) {
    n = Math.min(SHOP.limit, Math.max(0, Math.floor(Number(n)) || 0));
    const list = boughtBy(key).slice(), old = Math.max(0, Math.floor(Number(list[c])) || 0);
    list[c] = n;
    while (list.length && !list[list.length - 1]) list.pop();
    if (list.length) S.done.bought[key] = Array.from(list, (v) => v || 0); else delete S.done.bought[key];
    bump(key.slice(key.lastIndexOf('|') + 1), n - old, { buy: true });
  }
  // A finished count: processed (batches) or assembled (dishes); the stock moves by the difference.
  function setDone(kind, key, n) {
    n = Math.max(0, Math.floor(Number(n)) || 0);
    const old = Math.max(0, Math.floor(Number(S.done[kind][key])) || 0);
    if (n) S.done[kind][key] = n; else delete S.done[kind][key];
    worked(kind, key, n - old);
  }

  // A station (see S.done.proc) has `queue` places, each empty (null) or holding one batch { name, at, took }: at null
  // while it waits for 開工, else when the batch starts (ms). It makes one batch at a time, in the order started, and a
  // finished batch keeps its place until it is collected (領料). The batches fill the places from the top: one taken
  // out lets those below move up, and the empty places stay at the bottom until a batch is put in. took is what 開工
  // really took from the stock (less than the inputs when the stock was short), so taking the batch back out gives back
  // no more than that. log is the week's 領料, oldest first: { name, at, took, done (when collected), test (finished
  // at once in 測試) }.
  const procOf = (lane) => (S.done.proc[lane] && typeof S.done.proc[lane] === 'object' ? S.done.proc[lane] : (S.done.proc[lane] = {}));
  const secsFor = (name) => (REC.has(name) ? stepInfo(name).secs || 0 : 0) * 1000;
  // null until the places are first used this week (the page then shows the first batches in them, waiting).
  function slotsOf(lane) {
    const p = procOf(lane);
    // a round started before places existed: its batches, one after another from when it started
    if (p.run && Array.isArray(p.run.items) && !Array.isArray(p.slots)) {
      let at = Number(p.run.at) || Date.now();
      p.slots = p.run.items.map((name) => {
        const r = REC.get(name), x = { name, at, took: Object.fromEntries(r ? r.inputs.map((i) => [i.item, i.qty]) : []) };
        at += secsFor(name);
        return x;
      });
    }
    delete p.run;
    return Array.isArray(p.slots) ? p.slots : null;
  }
  const setSlots = (lane, slots) => { procOf(lane).slots = slots.map((x) => x || null); };
  const runningItems = () => Object.keys(S.done.proc).flatMap((lane) => (slotsOf(lane) || []).filter((x) => x && x.at != null).map((x) => x.name));
  const setOrder = (lane, order) => { procOf(lane).order = order.slice(); };
  // When a started batch ends.
  const endOf = (x) => x.at + secsFor(x.name);
  // 開工: every batch waiting in a place starts, one after another behind those already started, and its inputs leave
  // the stock now.
  function startSlots(lane, now) {
    const slots = slotsOf(lane);
    if (!slots) return;
    let free = Math.max(now, ...slots.filter((x) => x && x.at != null).map(endOf));
    for (const x of slots) {
      if (!x || x.at != null) continue;
      const r = REC.get(x.name);
      x.took = {};
      if (r) for (const i of r.inputs) { x.took[i.item] = (x.took[i.item] || 0) + Math.min(held(i.item), i.qty); bump(i.item, -i.qty, { use: x.name }); }
      x.at = free;
      free += secsFor(x.name);
    }
  }
  const logOf = (lane) => (Array.isArray(procOf(lane).log) ? procOf(lane).log : (procOf(lane).log = []));
  // Place k emptied: the batches below move up, the empty place goes to the bottom.
  const takeOut = (slots, k) => { slots.splice(k, 1); slots.push(null); };
  // The started batches not yet under way move up behind the others (one under way keeps its start).
  function rechain(slots, now) {
    let free = -Infinity;
    for (const y of slots.filter((s) => s && s.at != null).sort((a, b) => a.at - b.at)) {
      if (y.at > now) y.at = Math.max(now, free);
      free = endOf(y);
    }
  }
  // 領料: a finished batch counts as processed, its output joins the stock, it goes on the log and leaves its place.
  // test: finished at once (測試), without waiting for its time; one still waiting for 開工 takes its inputs first.
  function collectSlot(lane, k, now, test = false) {
    const slots = slotsOf(lane), x = slots && slots[k];
    if (!x || (x.at == null && !test)) return;
    const r = REC.get(x.name);
    if (x.at == null) {
      x.took = {};
      if (r) for (const i of r.inputs) { x.took[i.item] = (x.took[i.item] || 0) + Math.min(held(i.item), i.qty); bump(i.item, -i.qty, { use: x.name }); }
      x.at = now;
    }
    S.done.processed[x.name] = (Math.floor(Number(S.done.processed[x.name])) || 0) + 1;
    if (r) bump(x.name, yieldOf(r), { make: x.name });
    logOf(lane).push({ name: x.name, at: x.at, took: x.took || {}, done: now, ...(test ? { test: true } : {}) });
    takeOut(slots, k);
    if (test) rechain(slots, now);
  }
  // 退回 a 領料 (log entry i): its output leaves the stock again, what it took goes back to the station's 投料區, and
  // the batch goes back to the front of the queue.
  function uncollect(lane, i) {
    const log = logOf(lane), e = log[i];
    if (!e) return;
    log.splice(i, 1);
    const r = REC.get(e.name), n = (Math.floor(Number(S.done.processed[e.name])) || 0) - 1;
    if (n > 0) S.done.processed[e.name] = n; else delete S.done.processed[e.name];
    if (r) bump(e.name, -yieldOf(r), { make: e.name });
    for (const [item, qty] of Object.entries(e.took || {})) bump(item, qty, { lane });
    procOf(lane).order = [e.name, ...(procOf(lane).order || [])];
  }
  // Taking a batch back out of its place: what 開工 took returns to the stock, the batch goes back to the front of the
  // queue, and the started batches behind it move up.
  function cancelSlot(lane, k, now) {
    const slots = slotsOf(lane), x = slots && slots[k];
    if (!x) return;
    takeOut(slots, k);
    procOf(lane).order = [x.name, ...(procOf(lane).order || [])];
    if (x.at == null) return;
    for (const [item, qty] of Object.entries(x.took || {})) bump(item, qty, { lane });
    rechain(slots, now);
  }

  // A raw material's weekly supply: its base plus what every shop can still sell every character this week.
  // Something that can be gathered, or whose source isn't known yet, has no cap (barter and quest loot aren't counted
  // on).
  function supplyOf(name, U) {
    const src = sourcesOf(name);
    const shops = src.filter((s) => s.kind === 'buy').sort((a, b) => townRank(a.town) - townRank(b.town));
    const gather = src.some((s) => s.kind === 'gather');
    const limited = shops.length > 0 && !gather;
    let buyCap = 0;
    for (const sh of shops) {
      const got = boughtBy(`${sh.who}|${sh.town || sh.note}|${name}`);
      for (let c = 0; c < chars(); c++) buyCap += Math.max(0, SHOP.limit - (Math.floor(Number(got[c])) || 0));
    }
    return { name, src, shops, gather, limited, unknown: !src.length, buyCap, cap: limited ? baseOf(name, U) + buyCap : Infinity };
  }
  // Each line of the wish list, top first, gets the most it can (up to its count) from what the lines above left.
  // A line's max is how many it could make on its own from that remainder; stuck lists what runs out one past it.
  function allocate() {
    const U = usedThisWeek(), sup = new Map(), left = new Map();
    const supply = (m) => {
      if (!sup.has(m)) { const s = supplyOf(m, U); sup.set(m, s); left.set(m, s.cap); }
      return sup.get(m);
    };
    const pool = new Map();
    for (const name of new Set([...Object.keys(S.have), ...U.used.keys(), ...U.made.keys()])) if (REC.has(name) && baseOf(name, U)) pool.set(name, baseOf(name, U));
    // What the whole wish list would take if nothing ran out, and which dishes want each material.
    const want = new Map(), wantBy = new Map(), wantPool = new Map(pool);
    for (const o of S.orders) {
      if (!REC.has(o.dish)) continue;
      const x = expand(o.dish, o.qty, wantPool);
      for (const [m, q] of x.raw) {
        want.set(m, (want.get(m) || 0) + q);
        if (!wantBy.has(m)) wantBy.set(m, new Set());
        wantBy.get(m).add(o.dish);
      }
      for (const [m, q] of x.use) wantPool.set(m, wantPool.get(m) - q);
      for (const [m, q] of x.left) wantPool.set(m, (wantPool.get(m) || 0) + q);
    }
    const over = (x) => [...x.raw].filter(([m, q]) => { supply(m); return q > left.get(m); }).map(([m]) => m);
    const fits = (dish, n) => !over(expand(dish, n, pool)).length;
    const add = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
    const A = { rows: [], sup, raw: new Map(), use: new Map(), net: new Map(), batches: new Map(), pool };
    S.orders.forEach((o, i) => {
      if (!REC.has(o.dish)) return;
      let max = Infinity;
      if (!fits(o.dish, 1e5)) {
        let lo = 0, hi = 1e5;
        while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (fits(o.dish, m)) lo = m; else hi = m - 1; }
        max = lo;
      }
      const n = Math.min(o.qty, max);
      const stuck = max < Infinity ? over(expand(o.dish, max + 1, pool)) : [];
      const x = expand(o.dish, n, pool);
      for (const [m, q] of x.raw) { supply(m); left.set(m, left.get(m) - q); add(A.raw, m, q); }
      for (const [m, q] of x.use) { pool.set(m, pool.get(m) - q); add(A.use, m, q); }
      for (const [m, q] of x.left) add(pool, m, q);
      for (const [m, b] of x.batches) add(A.batches, m, b);
      for (const [m, q] of x.net) add(A.net, m, q);
      A.rows.push({ i, dish: o.dish, qty: o.qty, n, max, stuck, batches: x.batches });
    });
    // How each raw material is covered: its base first, then what the shops can still sell, in board town order and
    // first character first, the rest gathered (or from a source still to be filled in). stock is the bag now, used
    // what this week's work has taken, so need - used is still to use and need - base still to get. buys has every
    // shop that sells it with each character's purchases (bought) and suggested purchases (more); shops only the ones
    // with something left to buy. want is what the full wish list would take; short is how much of a shop-only
    // material the limits can't cover (異常: not enough raw material), users the dishes that want it.
    A.mats = [...new Set([...A.raw.keys(), ...want.keys()])].map((name) => {
      const s = supply(name), need = A.raw.get(name) || 0, base = baseOf(name, U), have = Math.min(base, need), rest = need - have;
      const buy = Math.min(rest, s.buyCap);
      let r = buy;
      const buys = s.shops.map((sh) => {
        const key = `${sh.who}|${sh.town || sh.note}|${name}`, got = boughtBy(key);
        const per = Array.from({ length: chars() }, (_, c) => {
          const b = Math.max(0, Math.floor(Number(got[c])) || 0), k = Math.min(r, Math.max(0, SHOP.limit - b));
          r -= k;
          return { bought: b, more: k };
        });
        return { ...sh, key, per, bought: per.reduce((t, x) => t + x.bought, 0), qty: per.reduce((t, x) => t + x.more, 0) };
      });
      const w = want.get(name) || 0, short = s.limited ? Math.max(0, w - s.cap) : 0;
      return {
        name, need, have, buy, get: rest - buy, s, buys, shops: buys.filter((sh) => sh.qty), util: s.buyCap ? buy / s.buyCap : 0, want: w, short,
        stock: held(name), base, used: Math.round(U.used.get(name) || 0),
        users: [...(wantBy.get(name) || [])], stuck: A.rows.some((o) => o.n < o.qty && o.stuck.includes(name)),
      };
    });
    return A;
  }

  // The plan the stations run: every made item with its batches, and what is on hand at 0:00 (bought, gathered, held).
  function makePlan(A) {
    const steps = [...A.batches].map(([name, b]) => {
      const r = REC.get(name);
      return { name, r, need: A.net.get(name) || 0, batches: b, made: b * yieldOf(r), ...stepInfo(name) };
    });
    const height = new Map();
    const h = (name) => {
      if (!REC.has(name)) return 0;
      if (height.has(name)) return height.get(name);
      height.set(name, 1);
      const v = 1 + Math.max(0, ...REC.get(name).inputs.map((i) => h(i.item)));
      height.set(name, v);
      return v;
    };
    steps.forEach((s) => { s.height = h(s.name); });
    steps.sort((a, b) => a.height - b.height); // raw-side steps first
    steps.forEach((s, i) => { s.color = COLORS[i % COLORS.length]; });
    const out = [];
    for (const o of A.rows) if (o.n) { const d = out.find((x) => x.dish === o.dish); if (d) d.n += o.n; else out.push({ dish: o.dish, n: o.n }); }
    return {
      steps, dishes: out, dishSet: new Set(out.map((d) => d.dish)), qty: out.reduce((t, d) => t + d.n, 0),
      raw: [...A.raw].map(([name, qty]) => ({ name, qty })), stock: new Map([...A.raw, ...A.use]),
      missing: steps.filter((s) => s.secs == null),
    };
  }

  /* ---------- the schedule: every batch on its station ---------- */
  // A station makes one batch at a time. Batches start as soon as the station is free and their inputs are in stock
  // (raw materials are all on hand at 0:00), as if someone were there to collect and line up the next one; when
  // several steps share a station, the one with the most work still downstream of it goes first.
  function makeSchedule(P) {
    const byName = new Map(P.steps.map((s) => [s.name, s]));
    const consumers = new Map();
    for (const s of P.steps) for (const i of s.r.inputs) if (byName.has(i.item)) {
      if (!consumers.has(i.item)) consumers.set(i.item, []);
      consumers.get(i.item).push(s.name);
    }
    const rank = new Map();
    const rk = (n) => {
      if (rank.has(n)) return rank.get(n);
      rank.set(n, 0);
      const v = (byName.get(n).secs || 0) + Math.max(0, ...(consumers.get(n) || []).map(rk));
      rank.set(n, v);
      return v;
    };
    P.steps.forEach((s) => rk(s.name));
    const lanes = new Map();
    for (const s of P.steps) {
      if (!lanes.has(s.lane)) lanes.set(s.lane, { name: s.lane, equip: s.equip, queue: s.queue, steps: [], height: 0, free: 0 });
      const L = lanes.get(s.lane);
      L.steps.push(s);
      L.height = Math.max(L.height, s.height);
    }
    for (const L of lanes.values()) L.steps.sort((a, b) => rank.get(b.name) - rank.get(a.name));
    const inv = new Map(P.stock);
    const left = new Map(P.steps.map((s) => [s.name, s.batches]));
    const ready = (s) => left.get(s.name) > 0 && s.r.inputs.every((i) => (inv.get(i.item) || 0) >= i.qty);
    const jobs = [];
    let running = [], t = 0;
    for (let guard = 0; guard < 500000; guard++) {
      for (const L of lanes.values()) {
        while (L.free <= t) {
          const s = L.steps.find(ready);
          if (!s) break;
          for (const i of s.r.inputs) inv.set(i.item, inv.get(i.item) - i.qty);
          left.set(s.name, left.get(s.name) - 1);
          const job = { step: s.name, lane: L.name, start: t, end: t + (s.secs || 0) };
          jobs.push(job);
          running.push(job);
          L.free = job.end;
        }
      }
      if (!running.length) break;
      t = Math.min(...running.map((j) => j.end));
      running = running.filter((j) => {
        if (j.end > t) return true;
        const s = byName.get(j.step);
        inv.set(s.name, (inv.get(s.name) || 0) + yieldOf(s.r));
        return false;
      });
    }
    const total = jobs.reduce((m, j) => Math.max(m, j.end), 0);
    const stuck = [...left.values()].some((n) => n > 0);
    // Lookups for drawing any moment quickly: each station's jobs by start, each step's start and end times, each raw
    // item's draws.
    const laneJobs = new Map([...lanes.keys()].map((k) => [k, []]));
    for (const j of jobs) laneJobs.get(j.lane).push(j);
    const ends = new Map(P.steps.map((s) => [s.name, []]));
    const starts = new Map(P.steps.map((s) => [s.name, []]));
    const draws = new Map(P.raw.map((x) => [x.name, []]));
    for (const j of jobs) {
      ends.get(j.step).push(j.end);
      starts.get(j.step).push(j.start);
      for (const i of byName.get(j.step).r.inputs) if (draws.has(i.item)) draws.get(i.item).push([j.start, i.qty]);
    }
    for (const a of ends.values()) a.sort((x, y) => x - y);
    for (const a of starts.values()) a.sort((x, y) => x - y);
    for (const [k, a] of draws) {
      a.sort((x, y) => x[0] - y[0]);
      let sum = 0;
      draws.set(k, { at: a.map((d) => d[0]), sum: a.map((d) => (sum += d[1])) });
    }
    const byEnd = jobs.slice().sort((a, b) => a.end - b.end);
    return { jobs, byEnd, total, stuck, lanes: [...lanes.values()].sort((a, b) => a.height - b.height), laneJobs, ends, starts, draws };
  }
  // How many values in a sorted array are <= t.
  const countLE = (a, t) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; } return lo; };
  // The job running on a station at time t, if any.
  const jobAt = (SCH, lane, t) => {
    const list = SCH.laneJobs.get(lane) || [];
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].start <= t) lo = m + 1; else hi = m; }
    const j = list[lo - 1];
    return j && j.end > t && j.end > j.start ? j : null;
  };

  // The week as logins, for someone who isn't online the whole time. Each login collects everything finished, assembles
  // what it can (assembly takes seconds), and lines up to `queue` batches on every station from what is in stock (a
  // batch takes its inputs when it is lined up); the next login comes when the slowest station's line is done.
  // { rounds: [{ at, dur, lanes: station → { counts: item → batches, secs } }], total, logins, stuck,
  //   stations: [{ name, equip, queue, steps, batches, busy }] } — stations are the ones that take time.
  function loginPlan(P) {
    const byName = new Map(P.steps.map((s) => [s.name, s]));
    const inv = new Map(P.stock), left = new Map(P.steps.map((s) => [s.name, s.batches]));
    const ready = (s) => left.get(s.name) > 0 && s.r.inputs.every((i) => (inv.get(i.item) || 0) >= i.qty);
    const take = (s) => { for (const i of s.r.inputs) inv.set(i.item, inv.get(i.item) - i.qty); left.set(s.name, left.get(s.name) - 1); };
    const give = (s, n = 1) => inv.set(s.name, (inv.get(s.name) || 0) + n * yieldOf(s.r));
    // Downstream work first, as in the schedule.
    const rank = new Map();
    const rk = (n) => {
      if (rank.has(n)) return rank.get(n);
      rank.set(n, 0);
      const users = P.steps.filter((s) => s.r.inputs.some((i) => i.item === n)).map((s) => rk(s.name));
      const v = (byName.get(n).secs || 0) + Math.max(0, ...users);
      rank.set(n, v);
      return v;
    };
    P.steps.forEach((s) => rk(s.name));
    const instant = P.steps.filter(quick);
    const stations = new Map();
    for (const s of P.steps.filter((x) => !quick(x)).sort((a, b) => rank.get(b.name) - rank.get(a.name))) {
      if (!stations.has(s.lane)) stations.set(s.lane, { name: s.lane, equip: s.equip, queue: s.queue, steps: [], batches: 0, busy: 0 });
      const st = stations.get(s.lane);
      st.steps.push(s);
      st.batches += s.batches;
      st.busy += s.batches * (s.secs || 0);
    }
    const assemble = () => { for (const s of instant) while (ready(s)) { take(s); give(s); } };
    const rounds = [];
    let t = 0;
    for (let guard = 0; guard < 10000; guard++) {
      assemble();
      const round = { at: t, dur: 0, lanes: new Map() }, made = [];
      for (const st of stations.values()) {
        const counts = new Map();
        let secs = 0;
        for (let k = 0; k < Math.max(1, st.queue || 1); k++) {
          const s = st.steps.find(ready);
          if (!s) break;
          take(s);
          made.push(s);
          counts.set(s.name, (counts.get(s.name) || 0) + 1);
          secs += s.secs || 0;
        }
        if (counts.size) { round.lanes.set(st.name, { counts, secs }); round.dur = Math.max(round.dur, secs); }
      }
      if (!made.length) break;
      made.forEach((s) => give(s));
      rounds.push(round);
      t += round.dur;
    }
    assemble();
    return { rounds, total: t, logins: rounds.length ? rounds.length + 1 : 0, stuck: [...left.values()].some((n) => n > 0), stations: [...stations.values()] };
  }

  /* ---------- this week's actual progress ---------- */
  // A material that is gathered (or got from a source still to be filled in) rather than only bought: always when it
  // can't be bought, otherwise while the shops leave some to get.
  const gathers = (m) => !!(m.need || m.get) && (m.s.gather ? m.get > 0 || !m.s.shops.length : m.get > 0 || m.s.unknown);

  // The week's work in the order it is done — buy, gather, process, assemble — each line with its plan and what has
  // been done: a shop line is bought against bought plus still suggested, a gathered line is the stock against what is
  // still to use. Assembly opens only when every processing line is finished and the dish's direct materials are all
  // in hand: the dishes are assembled in one go at the end, not a portion at a time.
  function progress(A, P) {
    const D = S.done, num = (o, k) => Math.max(0, Math.floor(Number(o[k])) || 0);
    const buy = [], gather = [];
    for (const m of A.mats) {
      for (const sh of m.buys) if (sh.bought + sh.qty) buy.push({ kind: 'bought', key: sh.key, item: m.name, shop: sh, per: sh.per, plan: sh.bought + sh.qty, done: sh.bought });
      if (gathers(m)) {
        const g = m.s.src.find((x) => x.kind === 'gather'), plan = Math.max(0, m.need - m.used);
        gather.push({ kind: 'gathered', key: m.name, item: m.name, how: g ? g.text : '來源待補', plan, done: Math.min(m.stock, plan), left: m.get });
      }
    }
    // What each raw material has in hand for the week: its base (the stock plus what this week's work has used).
    const inHand = new Map(A.mats.map((m) => [m.name, m.base]));
    const missing = (inputs) => inputs.filter((i) => A.raw.has(i) && (inHand.get(i) || 0) < A.raw.get(i));
    const running = runningItems();
    const process = P.steps.filter((s) => !P.dishSet.has(s.name) && !quick(s)).map((s) => ({
      kind: 'processed', key: s.name, item: s.name, step: s, plan: s.batches, done: num(D.processed, s.name), running: running.filter((x) => x === s.name).length,
      waiting: missing(s.r.inputs.map((i) => i.item)),
    }));
    const unfinished = process.filter((r) => r.done < r.plan);
    const assemble = P.dishes.map((d) => {
      const waiting = [...unfinished.map((r) => `${r.item} ${r.done}/${r.plan} 批`), ...missing(REC.get(d.dish).inputs.map((i) => i.item)).map((i) => `${i}未齊`)];
      return { kind: 'assembled', key: d.dish, item: d.dish, plan: d.n, done: num(D.assembled, d.dish), waiting, ready: !waiting.length };
    });
    const lines = [...buy, ...gather, ...process, ...assemble];
    return { buy, gather, process, assemble, inHand, missing, total: lines.length, finished: lines.filter((r) => r.done >= r.plan).length };
  }

  /* ---------- editing the wish list, characters and holdings ---------- */
  // Both pages use the same controls: data-odish (a line's dish), data-num (a stepper's number: 'chars' or 'o' + a
  // line's index), data-step ('key|±n'), data-oset ('index|count'), data-omove ('index|±1'), data-odel (index),
  // data-have (an item's stock), data-done ('kind|key', an actual) and data-donefill ('kind|n|key'), data-buy
  // ('c|key', a character's purchase) and data-buyfill ('c|n|key'), and #add-order. `changed` redraws the page after
  // an edit.
  const ADD_QTY = 10;
  function setNum(key, n) {
    if (key === 'chars') S.chars = Math.min(MAX_CHARS, Math.max(1, n || 1));
    else if (S.orders[Number(key.slice(1))]) S.orders[Number(key.slice(1))].qty = Math.max(1, n || 1);
  }
  function wireList(changed) {
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.odish != null) { const o = S.orders[Number(t.dataset.odish)]; if (o) o.dish = t.value; }
      else if (t.dataset.num) setNum(t.dataset.num, posInt(t.value));
      else if (t.dataset.done) {
        const v = t.dataset.done, a = v.indexOf('|');
        setDone(v.slice(0, a), v.slice(a + 1), t.value);
      } else if (t.dataset.buy) {
        const v = t.dataset.buy, a = v.indexOf('|');
        setBought(v.slice(a + 1), Number(v.slice(0, a)), t.value);
      } else if (t.dataset.have != null) {
        const n = Math.floor(Number(t.value));
        if (n > 0) S.have[t.dataset.have] = n; else delete S.have[t.dataset.have];
      } else return;
      save();
      setTimeout(changed, 0); // after the focus has moved on, so the page can put it back
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.step) {
        const [key, d] = b.dataset.step.split('|');
        setNum(key, (key === 'chars' ? chars() : (S.orders[Number(key.slice(1))] || {}).qty || 0) + Number(d));
      } else if (b.dataset.oset) {
        const [i, n] = b.dataset.oset.split('|').map(Number);
        setNum(`o${i}`, n);
      } else if (b.dataset.omove) {
        const [i, d] = b.dataset.omove.split('|').map(Number), j = i + d;
        if (!S.orders[i] || !S.orders[j]) return;
        [S.orders[i], S.orders[j]] = [S.orders[j], S.orders[i]];
      } else if (b.dataset.odel) {
        S.orders.splice(Number(b.dataset.odel), 1);
      } else if (b.dataset.donefill || b.dataset.buyfill) {
        // 'kind|n|key': set a line to n (its plan, or 0 to clear it); 'c|n|key': set a character's purchase to n
        const v = b.dataset.donefill || b.dataset.buyfill, a = v.indexOf('|'), c = v.indexOf('|', a + 1);
        if (b.dataset.donefill) setDone(v.slice(0, a), v.slice(c + 1), v.slice(a + 1, c));
        else setBought(v.slice(c + 1), Number(v.slice(0, a)), v.slice(a + 1, c));
      } else if (b.id === 'add-order') {
        const taken = new Set(S.orders.map((o) => o.dish));
        const next = dishes().find((r) => !taken.has(r.name)) || dishes()[0];
        if (!next) return;
        S.orders.push({ dish: next.name, qty: ADD_QTY });
      } else return;
      save();
      changed();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-num], input[data-have], input[data-done], input[data-buy]')) e.target.blur();
    });
  }

  window.LineCore = {
    wireList,
    LINE, SHOP, CITIES, MAX_CHARS, COLORS, S, save, REC, load, dishes, dishOptions, esc, fmt, posInt, readLS, writeLS,
    fmtDur, clock, parseDur, shopWeek, yieldOf, gradeOf, nameHTML, sourcesOf, sourceText, townRank,
    stepInfo, quick, chars, charsFromBoard, held, allocate, makePlan, makeSchedule, countLE, jobAt, loginPlan, progress,
    gathers, setBought, setDone, slotsOf, setSlots, setOrder, startSlots, collectSlot, uncollect, cancelSlot, logOf, onStock,
  };
})();
