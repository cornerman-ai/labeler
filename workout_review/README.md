# Workout review

https://cornerman-ai.github.io/labeler/workout_review/

The team goes through every lesson and workout of AMBO's courses and says, for each: did it work for them
(Worked / Partly / Didn't work), was it clear (Clear / Somewhat / Confusing), and a note. Everyone sees
everyone's notes, on each workout and on the **Team notes** page.

- `workouts.json` is the courses on the site as the app has them: Fundamentals only for now (`ON_SITE` in the
  script; the courses still being made stay in the app), written from the app's own data by the ios repo:
  `node scripts/course-status.mjs --json ../labeler/workout_review/workouts.json` (re-run it when the courses
  change; never edit it by hand). A note is keyed by `course/lesson` or `course/lesson/drill` ids, so it
  stays on its workout when the order changes.
- `img/` holds the course cards (from the app's `assets/images/courses/*-card.jpg`, 1100 px wide).
- Notes save through the shared Apps Script, `doGetWorkoutReview` in `apps_script/Code.js`, to its own
  workbook, **Workout review notes** (made on first use, beside the roll eyes workbook), tab `Notes`:
  `ts | reviewer | item | course | lesson | title | worked | clear | comment | at`.

## No lost or crossed notes

- One row per (reviewer, item): a save rewrites only the reviewer's own row, under the script lock, so two
  people saving at once never touch each other's notes.
- Each change is kept in the browser first (localStorage, per name) with the time it was made (`at`), then
  sent by one sender, one note at a time, retried with backoff until the backend says ok; a page with notes
  still out warns before closing.
- The backend ignores a save older than the row it has (`at`), so a retry or a second tab landing late
  can't undo a newer note. Everyone's notes are read back every 45 s and when the tab comes back.

The name is the labelers' shared one (`labelerName` in localStorage, as `shared/labeler_name.js`).

When `style.css` or `app.js` change, bump their `?v=` in `index.html`: GitHub Pages lets browsers keep a file
for 10 minutes, so without it people see the old page for a while.
