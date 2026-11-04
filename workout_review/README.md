# Workout review

https://cornerman-ai.github.io/labeler/workout_review/

The team answers two questions on every workout of AMBO's courses: **Was everything clear?** and **Did
everything work well?** (Yes / No), and when either is a no, what wasn't or what didn't. Nothing of the workout
itself is shown: it's all checked in the app. The courses are a menu as in the app: a course's card opens its
lessons, a lesson its workouts with their questions. **Team notes** lists everyone's answers.

- `workouts.json` is the courses on the site, ids and names only: Fundamentals for now (`ON_SITE` in the script;
  the courses still being made stay in the app). Written from the app's own data by the ios repo:
  `node scripts/workout-review-data.mjs` (re-run it when the courses change; never edit it by hand). An answer is
  keyed by `course/lesson/workout` ids, so it stays on its workout when the order changes.
- `img/` holds the course cards (from the app's `assets/images/courses/*-card.jpg`, 1100 px wide).
- Answers save through the shared Apps Script, `doGetWorkoutReview` in `apps_script/Code.js`, to its own
  workbook, **Workout review notes** (made on first use, beside the roll eyes workbook), tab `Notes`:
  `ts | reviewer | item | course | lesson | title | worked | clear | comment | at` (`clear` and `worked`: yes or
  no; `comment`: what wasn't clear or didn't work).

## No lost or crossed notes

- One row per (reviewer, workout): a save rewrites only the reviewer's own row, under the script lock, so two
  people saving at once never touch each other's answers.
- Each change is kept in the browser first (localStorage, per name) with the time it was made (`at`), then
  sent by one sender, one note at a time, retried with backoff until the backend says ok; a page with notes
  still out warns before closing.
- The backend ignores a save older than the row it has (`at`), so a retry or a second tab landing late
  can't undo a newer note. Everyone's notes are read back every 45 s and when the tab comes back.

The name is the labelers' shared one (`labelerName` in localStorage, as `shared/labeler_name.js`).

When `style.css` or `app.js` change, bump their `?v=` in `index.html`: GitHub Pages lets browsers keep a file
for 10 minutes, so without it people see the old page for a while.
