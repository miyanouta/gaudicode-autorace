// ============================================================
// GAUDICODE オートレース データ取得ライブラリ (autorace.jp)
// ------------------------------------------------------------
// autorace.jp は Laravel 製。出走表・結果は CSRF トークン付きの
// POST で JSON が返る。
//   1. GET /race_info/Program/{placeCode}/{date} で Cookie と
//      meta csrf-token を取得
//   2. POST /race_info/Program        (出走表+近況成績)
//      POST /race_info/OtherRaceInfo (レース名・距離・発走時刻・天候)
//      POST /race_info/RaceResult    (着順・払戻)
//      に placeCode / raceDate / raceNo を送る
//   開催情報は GET /race_info/XML/Hold/Today (JSON)
// ============================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const BASE = 'https://autorace.jp';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookieJar = '';
let csrfToken = '';
let refererUrl = '';

export async function initSession(placeCode, date) {
  refererUrl = `${BASE}/race_info/Program/${placeCode}/${date}`;
  const res = await fetch(refererUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Program page GET failed: ${res.status}`);
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  cookieJar = setCookies.map((c) => c.split(';')[0]).join('; ');
  const html = await res.text();
  const m = html.match(/csrf-token" content="([^"]+)"/);
  if (!m) throw new Error('csrf-token not found');
  csrfToken = m[1];
  return true;
}

export async function postForm(path, params) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-CSRF-TOKEN': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieJar,
      Referer: refererUrl,
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const j = await res.json();
  if (j.result !== 'Success') throw new Error(`${path} not Success: ${JSON.stringify(j).slice(0, 200)}`);
  return j.body;
}

export async function fetchHoldToday() {
  const res = await fetch(`${BASE}/race_info/XML/Hold/Today`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Hold/Today HTTP ${res.status}`);
  const j = await res.json();
  if (j.result !== 'Success') throw new Error('Hold/Today not Success');
  return j.body.today || [];
}
