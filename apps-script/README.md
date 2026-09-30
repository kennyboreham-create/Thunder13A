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

## Send all scorecards

The scorecards page can email each player their own card. The Apps Script reads the same scorecard numbers the page shows, builds one HTML email per player, and sends it through [Resend](https://resend.com). Nothing is sent until the coach confirms on the page.

The Resend API key stays in Apps Script **Script properties**. Do not paste it into this repo, `scorecards.html`, or any other page.

### 1. Add the email column

On the `players` tab, add a column whose header is `email`. It can be the last column. Put one address on each player row. A blank cell means that player is skipped. An address that is not a normal email is skipped too.

Player ids **105**, **909**, and **911** are never emailed.

### 2. Paste the new file

1. Open the **hockeyDB** Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Click **+** (Add a file) and paste the full contents of [`scorecards_email.gs`](scorecards_email.gs).

Leave `scorecards.gs` in the project. The mailer calls `getTeamScorecards_()`.

### 3. Add two lines

Inside the existing `doGet(e)`, next to the other `action` checks, add:

```javascript
if (action === "getScorecardEmailPreview") { return jsonResponse(previewScorecardEmails_(e.parameter.weekStart)); }
```

Inside the existing `doPost(e)`, where `action` is `e.parameter.action`, add:

```javascript
if (action === "sendAllScorecards") { return jsonResponse(sendAllScorecards_(e.parameter.sendKey, e.parameter.weekStart)); }
```

Do not change the other branches. `weekStart` is the Monday of the week to send (`yyyy-MM-dd`). The page sends the week that is selected. If it is left blank, the script uses the previous completed Monday–Sunday week in `America/Toronto`.

### 4. Set the script properties

In the Apps Script editor, open **Project Settings** (the gear) and then **Script properties**. Add:

| Property | Value |
|----------|--------|
| `RESEND_API_KEY` | The API key from your Resend account. |
| `RESEND_FROM` | Optional. The sender, for example `Thunder 13A <scorecards@players.coachinghockey.ca>`. If you leave it blank, that address is used. |
| `SCORECARD_SEND_KEY` | A passphrase you choose. The coach types it on the scorecards page before a send. |

The page remembers that passphrase in the browser tab only (`sessionStorage`). It is not written into the website.

### 5. Run once to authorize

In the editor, choose `previewScorecardEmails_` in the function dropdown and click **Run**. Approve the permissions.

`UrlFetchApp` needs permission to call an external service. Saving this file adds that call, and running any function once makes the editor ask for it. Running the preview reads the sheet and does not send email.

### 6. Deploy a new version

1. Click **Deploy > Manage deployments**.
2. On the existing web app deployment, click the pencil (**Edit**).
3. Set **Version** to **New version**.
4. Click **Deploy**.

**New version** keeps the same `/exec` URL. You do not need to change `API_URL` on the page.

Until this deploy is done, **Send all scorecards** explains that the action is not on the web app yet. The rest of the scorecards page still loads.

### 7. Verify the domain in Resend

In Resend, verify `players.coachinghockey.ca` (or the domain in `RESEND_FROM`). Resend will not deliver from an address on a domain you have not verified.

### What the coach sees

On `scorecards.html`, pick the week, then click **Send all scorecards**. The page loads a preview: who will get mail (address masked), who is skipped, and which week will be sent. Nothing goes out until **Confirm and send**. The button stays disabled while the send is running. The result lists how many were sent and names any failure with the error from Resend.

Each player gets one email, to their own address, with only their own scorecard. The subject is `<Name> — Thunder 13A Scorecard (Week of <range>)`. Percentages use the same rules as the page: Strategy is completed divided by the current Strategy total; a workout week is 100% with at least one day; a skills week is min(days, 2) / 2; overall workout and skills average those weekly percents from the first tracked week through the last completed week. Attendance is attended divided by total events, or an em dash when it cannot be calculated.
