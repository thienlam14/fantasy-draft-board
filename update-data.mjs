// scripts/update-data.mjs
//
// Pulls current-season box-score stats from balldontlie.io and current
// team / position-eligibility / injury-status from Sleeper's free public
// player database, merges them by name, computes each player's custom
// fantasy score, and writes the result to data/players.json.
//
// Run manually with:  BALLDONTLIE_API_KEY=xxxx node scripts/update-data.mjs
// Run automatically via .github/workflows/update-data.yml (daily cron).

const BALLDONTLIE_KEY = process.env.BALLDONTLIE_API_KEY;
if (!BALLDONTLIE_KEY) {
  console.error("Missing BALLDONTLIE_API_KEY environment variable.");
  console.error("Get a free key at https://app.balldontlie.io/ and set it");
  console.error("as a GitHub Actions secret (or export it locally).");
  process.exit(1);
}

const BDL_BASE = "https://api.balldontlie.io/v1";

// NBA seasons are labeled by their starting year (2026-27 season = 2026).
// This assumes the script runs during or after the season starts (October);
// adjust manually if you need last season's data before opening night.
const now = new Date();
const SEASON = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

const MIN_GAMES_PLAYED = 5; // skip tiny/garbage-time samples

async function bdlFetch(path) {
  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: { Authorization: BALLDONTLIE_KEY },
  });
  if (!res.ok) {
    throw new Error(`balldontlie request failed (${res.status}): ${path}`);
  }
  return res.json();
}

async function getAllActivePlayers() {
  let all = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ per_page: "100" });
    if (cursor) qs.set("cursor", String(cursor));
    const data = await bdlFetch(`/players/active?${qs}`);
    all = all.concat(data.data);
    cursor = data.meta && data.meta.next_cursor;
  } while (cursor);
  return all;
}

async function getSeasonAverages(playerIds, season) {
  const out = [];
  for (let i = 0; i < playerIds.length; i += 100) {
    const batch = playerIds.slice(i, i + 100);
    const qs = new URLSearchParams({ season: String(season), type: "base" });
    batch.forEach((id) => qs.append("player_ids[]", String(id)));
    const data = await bdlFetch(`/season_averages/general?${qs}`);
    out.push(...data.data);
    // Free tier is rate-limited — be polite between batches.
    await new Promise((r) => setTimeout(r, 800));
  }
  return out;
}

async function getSleeperPlayers() {
  const res = await fetch("https://api.sleeper.app/v1/players/nba");
  if (!res.ok) throw new Error(`Sleeper players request failed (${res.status})`);
  return res.json();
}

function normalizeName(n) {
  return (n || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents so Jokić == Jokic
    .replace(/[^a-z]/g, "");
}

// Same custom scoring formula used in the draft board this season.
// Double-double / triple-double bonuses are NOT included here — the
// free balldontlie tier doesn't expose per-game DD/TD counts. See the
// README for how to layer that back in manually if you want it exact.
function fantasyPoints(s) {
  const pts = s.pts || 0,
    reb = s.reb || 0,
    ast = s.ast || 0,
    stl = s.stl || 0,
    blk = s.blk || 0,
    tov = s.turnover || 0,
    fgm = s.fgm || 0,
    fga = s.fga || 0,
    ftm = s.ftm || 0,
    fta = s.fta || 0,
    tp = s.fg3m || 0;
  return (
    pts + reb + 2 * ast + 4 * stl + 3.5 * blk - 1.5 * tov +
    2 * fgm - 0.85 * fga + ftm - (fta - ftm) + tp
  );
}

function tierFor(fp) {
  if (fp >= 55) return "S";
  if (fp >= 45) return "A";
  if (fp >= 35) return "B";
  return "C";
}

async function main() {
  console.log(`Season: ${SEASON}`);

  console.log("Fetching active players from balldontlie...");
  const players = await getAllActivePlayers();
  console.log(`  ${players.length} active players`);

  console.log("Fetching Sleeper player database (team / position / injury status)...");
  const sleeper = await getSleeperPlayers();
  const sleeperByName = {};
  for (const id in sleeper) {
    const sp = sleeper[id];
    if (!sp.full_name) continue;
    sleeperByName[normalizeName(sp.full_name)] = sp;
  }
  console.log(`  ${Object.keys(sleeperByName).length} named Sleeper entries`);

  console.log("Fetching season averages (batched, rate-limited)...");
  const ids = players.map((p) => p.id);
  const averages = await getSeasonAverages(ids, SEASON);
  const avgById = Object.fromEntries(averages.map((a) => [a.player_id, a]));
  console.log(`  ${averages.length} season-average rows`);

  const out = [];
  for (const p of players) {
    const avg = avgById[p.id];
    if (!avg || !avg.games_played || avg.games_played < MIN_GAMES_PLAYED) continue;

    const fullName = `${p.first_name} ${p.last_name}`;
    const sp = sleeperByName[normalizeName(fullName)];
    if (!sp) continue; // not in Sleeper's active database -> not rosterable
    if (sp.status && sp.status !== "Active") continue; // released / retired / etc.

    const fp = fantasyPoints(avg);
    const positions = sp.fantasy_positions && sp.fantasy_positions.length
      ? sp.fantasy_positions
      : [p.position || "F"];

    out.push({
      name: fullName,
      team: sp.team || (p.team && p.team.abbreviation) || "FA",
      positions,
      pos: positions[0],
      PTS: avg.pts, TRB: avg.reb, AST: avg.ast, STL: avg.stl, BLK: avg.blk,
      TOV: avg.turnover, FG: avg.fgm, FGA: avg.fga, FT: avg.ftm, FTA: avg.fta, TP: avg.fg3m,
      FP: Math.round(fp * 100) / 100,
      rawFP: Math.round(fp * 100) / 100,
      draftFP: Math.round(fp * 100) / 100,
      currentStatus: sp.injury_status || null,
      // These research layers are NOT auto-generated — see README.
      risk: null, riskNote: null,
      trajectory: null, trajectoryNote: null,
      consistency: null, consistencyNote: null,
      trend: null, note: null,
      ddPerGame: null, tdPerGame: null,
    });
  }

  out.sort((a, b) => b.draftFP - a.draftFP);
  out.forEach((p) => { p.tier = tierFor(p.draftFP); });

  const fs = await import("fs");
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/players.json", JSON.stringify(out, null, 2));
  fs.writeFileSync(
    "data/last_updated.json",
    JSON.stringify({ updatedAt: new Date().toISOString(), season: SEASON, count: out.length }, null, 2)
  );
  console.log(`Wrote ${out.length} players to data/players.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
