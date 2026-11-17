// ============================================================
// GAUDICODE オートレース 結果取得スクリプト (結果のみマージ)
// ------------------------------------------------------------
// 指定日のレース結果 (着順・三連複/三連単の払戻) を autorace.jp 公式から
// 取得し、data/<date>.json の各レースに result としてマージする。
// 予想 (prediction) と出走表は一切変更しない (予想凍結)。
// あわせて保存済み予想プランの的中判定 (result.hits) も記録する。
// まだ結果が出ていないレースは result を付けずに残す (再実行で埋まる)。
// 結果が記録済みのレースは再取得しない。
//
// 使い方: node scripts/fetch-results.mjs [YYYY-MM-DD] [--venue=5]
// 前提: その日の data/<date>.json が存在すること。
// ============================================================
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSession, postForm, sleep } from './fetch-lib.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const args = process.argv.slice(2);
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const venueArg = (args.find((a) => a.startsWith('--venue=')) || '').split('=')[1] || null;
const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
const DATE = dateArg || jstNow.toISOString().slice(0, 10);
const isToday = DATE === jstNow.toISOString().slice(0, 10);
const nowMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();

function toResult(body) {
  const rr = body.raceResult || [];
  if (!rr.length) return null;
  const finishers = rr.filter((x) => x.order >= 1).sort((a, b) => a.order - b.order || a.carNo - b.carNo);
  if (finishers.length < 3) return null;
  const top3 = finishers.slice(0, 3).map((x) => x.carNo);
  const rf = body.refundInfo || {};
  const entries = (sec) => ((rf[sec] && rf[sec].list) || [])
    .map((e) => ({ nums: [e['1thCarNo'], e['2thCarNo'], e['3thCarNo']].filter((n) => n != null), refund: e.refund }))
    .filter((e) => e.nums.length === 3);
  const fukuEntries = entries('rf3').map((e) => ({ combo: [...e.nums].sort((a, b) => a - b).join('-'), refund: e.refund }));
  const tanEntries = entries('rt3').map((e) => ({ combo: e.nums.join('-'), refund: e.refund }));
  const sorted = [...top3].sort((a, b) => a - b).join('-');
  const fukuHit = fukuEntries.find((e) => e.combo === sorted) || fukuEntries[0];
  const tanHit = tanEntries.find((e) => e.combo === top3.join('-')) || tanEntries[0];
  return {
    top3,
    sanrenpuku: { combo: sorted, payout: fukuHit ? fukuHit.refund : null },
    sanrentan: { combo: top3.join('-'), payout: tanHit ? tanHit.refund : null },
    winCombos: { fuku: fukuEntries.map((e) => e.combo), tan: tanEntries.map((e) => e.combo) },
  };
}

const norm = (s) => s.split('-').map(Number).sort((a, b) => a - b).join('-');
function evaluate(prediction, result) {
  const hits = {};
  const p = prediction;
  if (p?.plans && result.sanrenpuku) {
    const winKeys = (result.winCombos?.fuku?.length ? result.winCombos.fuku : [norm(result.sanrenpuku.combo)]);
    for (const tier of ['teppan', 'balance', 'shoubu'])
      if (Array.isArray(p.plans[tier])) hits[tier] = p.plans[tier].map(norm).some((c) => winKeys.includes(c));
  }
  if (p?.plansTan && result.sanrentan) {
    const winOrders = (result.winCombos?.tan?.length ? result.winCombos.tan : [result.sanrentan.combo])
      .map((c) => c.replace(/-/g, '→'));
    for (const tier of ['teppan', 'balance', 'shoubu'])
      if (Array.isArray(p.plansTan[tier])) hits['tan' + tier[0].toUpperCase() + tier.slice(1)] = p.plansTan[tier].some((c) => winOrders.includes(c));
    hits.sanrentan = hits.tanTeppan;
  }
  return hits;
}

const path = `${ROOT}/data/${DATE}.json`;
const data = JSON.parse(await readFile(path, 'utf8'));
let updated = 0;
for (const venue of data.venues || []) {
  const placeCode = parseInt(venue.id, 10);
  if (venueArg && String(placeCode) !== venueArg) continue;
  const targets = (venue.races || []).filter((r) => {
    if (r.result) return false;
    if (r.status === 'error') return false;
    if (isToday && r.startTime) {
      const m = String(r.startTime).match(/(\d+):(\d+)/);
      if (m) {
        const start = Number(m[1]) * 60 + Number(m[2]);
        if (nowMinutes < start + 10) return false; // 発走+10分までは結果未公開
      }
    }
    return true;
  });
  if (!targets.length) continue;
  await initSession(placeCode, DATE);
  for (const race of targets) {
    try {
      const body = await postForm('/race_info/RaceResult', {
        placeCode: String(placeCode), raceDate: DATE, raceNo: String(race.no),
      });
      const result = toResult(body);
      if (result) {
        race.result = { ...result, hits: evaluate(race.prediction, result) };
        updated++;
        console.log(`  ${venue.name} ${race.no}R: 結果を取り込み`);
      }
    } catch (e) {
      console.error(`  ${venue.name} ${race.no}R 結果取得失敗: ${e.message}`);
    }
    await sleep(250);
  }
}
if (updated > 0) {
  data.resultsUpdatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(data, null, 1));
}
console.log(`結果取り込み: ${updated}件 (${DATE})`);
