# Fantasy Draft Board — self-updating site

A custom-scoring NBA fantasy draft board that refreshes itself once a day:
current-season stats + Sleeper's team/position/injury data get pulled
automatically, recomputed into your league's scoring format, and published
as `data/players.json`, which the site (`index.html`) loads live.

## What updates automatically vs. what doesn't

**Automatic (every night, via GitHub Actions):**
- Current-season per-game stats for every active player (balldontlie.io)
- Current team, position eligibility, and injury status (Sleeper — free, no key)
- Players who leave the league (retire / get released / go unsigned) drop out
  automatically because they stop appearing in Sleeper's active list
- Newly signed free agents and rookies appear automatically once they have
  played at least 5 games (`MIN_GAMES_PLAYED` in the script)
- Your custom fantasy-point formula, recalculated fresh each run

**NOT automatic — these were research/judgment layers built by hand and will
need periodic manual refresh (e.g., ask Claude again each preseason):**
- Chronic injury-risk discount (the colored risk dot + note)
- 5-year trajectory tag (rising/declining)
- Real double-double/triple-double bonus (the free stats tier doesn't expose
  per-game DD/TD counts — the automated pipeline sets this to 0; you had
  exact DD/TD data this season from a manual pull, see below)
- Real volatility/consistency tag (also required a manual pull from a
  third-party site; not available via a free automated API)
- Offseason trade "who gains/loses touches" narrative adjustments

You can still see all of this season's manually-researched values — they're
just frozen at whatever they were when last generated, until you re-run that
research and merge it back into `data/players.json` (the automated script
won't overwrite fields it doesn't set, as long as you merge rather than
replace — see "Keeping the manual layers" below).

## One-time setup

1. **Create a GitHub repo** and push these files to it (`index.html`,
   `data/`, `scripts/`, `.github/`).
2. **Get a free balldontlie API key**: sign up at https://app.balldontlie.io/
   (free tier, rate-limited but sufficient for one run per day).
3. **Add it as a GitHub secret**: repo → Settings → Secrets and variables →
   Actions → New repository secret → name it `BALLDONTLIE_API_KEY`.
4. **Enable GitHub Pages**: repo → Settings → Pages → Source: "Deploy from a
   branch" → Branch: `main` → `/ (root)`. Your site will be live at
   `https://<your-username>.github.io/<repo-name>/`.
5. **Enable Actions** if it's not already (it is by default on new repos).
   The workflow in `.github/workflows/update-data.yml` runs daily at 09:00
   UTC and can also be triggered manually from the Actions tab
   ("Run workflow").

That's it — from here, the data refreshes itself daily and Pages
auto-redeploys whenever `data/players.json` changes.

## Running the update script manually (optional, for testing)

```bash
export BALLDONTLIE_API_KEY=your_key_here
node scripts/update-data.mjs
```

This writes `data/players.json` and `data/last_updated.json`. Commit and
push them (or just let the scheduled Action do it).

## Keeping the manual research layers alive

The automated script never touches: `risk`, `riskNote`, `trajectory`,
`trajectoryNote`, `consistency`, `consistencyNote`, `trend`, `note`,
`ddPerGame`, `tdPerGame` — it sets them all to `null` for anyone it doesn't
already know about, but if you want to preserve last season's research when
re-running, do this instead of blindly overwriting:

1. Run the script to a temp file: `node scripts/update-data.mjs` (writes to
   `data/players.json` as normal).
2. Before committing, manually merge forward any `risk`/`trajectory`/
   `consistency`/`note` fields you want to keep for players who are still in
   the dataset, by name.
3. Or — easiest — just paste the new `data/players.json` into a fresh Claude
   conversation each preseason and ask it to re-run the same research passes
   (trade impact, injury risk, 5-year trajectory, volatility) on the updated
   player pool. That's genuinely faster than automating research/judgment,
   which isn't something a nightly script can do.

## Changing the schedule

Edit the `cron` line in `.github/workflows/update-data.yml`. Cron syntax is
`minute hour day month weekday`, always in UTC. https://crontab.guru is handy
for building/checking one.

## Season rollover

The script assumes the current NBA season is running (season "year" =
the year it started in, e.g. the 2026-27 season is `season=2026`). It
auto-detects this from the current month once October hits. Nothing to
change year over year — it just keeps working.

## Files

```
index.html                        the draft board (fetches data/players.json)
data/players.json                 generated player data (source of truth for the site)
data/last_updated.json            timestamp + count shown in the site header
scripts/update-data.mjs           the fetch + merge + scoring pipeline
.github/workflows/update-data.yml the daily cron job
```
