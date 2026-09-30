# Scorecards Apps Script

`scorecards.html` reads team scorecards from the Google Apps Script web app that is already bound to the **hockeyDB** spreadsheet. That script is not in this repo. Paste the new function in, add one line to `doGet`, and redeploy a new version. The web app URL stays the same.

## 1. Paste the function

1. Open the **hockeyDB** Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Add a script file (or scroll to the bottom of an existing `.gs` file) and paste the full contents of [`scorecards.gs`](scorecards.gs).

Pasting adds one function, `getTeamScorecards_()`. It only reads sheets. It does not replace `doGet` and it does not change any existing action.

## 2. Add one line to `doGet`

Inside the existing `doGet(e)` action switch, next to the other `action === '...'` checks, add this single line. Do not change any other branch:

```javascript
if (action === 'getTeamScorecards') return ContentService.createTextOutput(JSON.stringify(getTeamScorecards_())).setMimeType(ContentService.MimeType.JSON);
```

The same line is in the comment at the top of `scorecards.gs`.

## 3. Redeploy (same URL)

1. Click **Deploy > Manage deployments**.
2. On the existing web app deployment, click the pencil (**Edit**).
3. Set **Version** to **New version**.
4. Click **Deploy**.

**New version** keeps the same `/exec` URL that the site already calls. You do not need to change `API_URL`.

Then open `scorecards.html`. Until this deploy is done, that page shows a message that the Apps Script update still needs to be deployed.

## Attendance tab

Create a sheet tab named `attendance` if it does not exist yet. Columns:

| player id | attended | away | total events |
|-----------|----------|------|----------------|

Header names are matched case-insensitively, and extra spaces are ignored (`Player ID`, `total_events`, and `Total Events` all work). One row per player. If this tab is missing, every player's attendance is `null` and the page shows an em dash.

## What the function returns

- Players from the `players` tab: `id`, `name`, `jersey`. Ids **105**, **909**, and **911** are left out. Passwords are never sent.
- `strategyTotal`: how many current `lessons` rows have category `Strategy`. Blank rows and the control lessons `L_WEEKLY_WORKOUT` and `L_DAILY_SKILLS` are ignored.
- Per player, the distinct Strategy lesson ids completed in `player_progress` (`activity_type` `LESSON_COMPLETED`).
- Per player, distinct `America/Toronto` dates (`yyyy-MM-dd`) that have any workout check and any skills check. Those rows are `activity_type` `COMPLETED_DASHBOARD_TRACKER` whose `activity_id` starts with `WORKOUT_` or `SKILLS_` (any capitalization). The date comes from the `timestamp` column.
- Per player, attendance `{ attended, away, total }`, or `null` when the attendance tab is missing.

Weekly percentages are calculated in the browser on `scorecards.html`, not in the script.
