/**
 * Send each player their own scorecard by email.
 *
 * Paste this entire file into the Apps Script project bound to the Google
 * Sheet "hockeyDB", next to scorecards.gs. Do not replace doGet or doPost.
 * This file does not write to the spreadsheet. It reads getTeamScorecards_()
 * and the players tab email column, then POSTs one Resend email per player.
 *
 * The web app is anonymous, so send is refused unless the coach's passphrase
 * matches the SCORECARD_SEND_KEY script property. The Resend API key stays in
 * script properties. Never put it in the sheet, this file, or the website.
 *
 * Add this line inside the existing doGet(e), next to the other action checks:
 *
 * if (action === "getScorecardEmailPreview") { return jsonResponse(previewScorecardEmails_(e.parameter.weekStart)); }
 *
 * Add this line inside the existing doPost(e), where action is e.parameter.action:
 *
 * if (action === "sendAllScorecards") { return jsonResponse(sendAllScorecards_(e.parameter.sendKey, e.parameter.weekStart)); }
 *
 * UrlFetchApp needs the external-request authorization. The editor asks for
 * that permission when you run any function after this file is saved, because
 * the project now calls UrlFetchApp. Run previewScorecardEmails_ once from the
 * editor. That reads the sheet and does not send mail. Then redeploy:
 * Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy.
 *
 * Script properties (Project Settings > Script properties):
 * - RESEND_API_KEY       Resend API key. Never paste it into the repo or the page.
 * - RESEND_FROM          Optional. Defaults to Thunder 13A <scorecards@players.coachinghockey.ca>
 * - SCORECARD_SEND_KEY   Passphrase the coach types on the scorecards page.
 *
 * weekStart is optional on both calls. When it is present it must be the
 * Monday of the week to send, as yyyy-MM-dd. When it is blank, the previous
 * completed Monday–Sunday week in America/Toronto is used.
 *
 * Preview JSON:
 * {
 *   success: true,
 *   weekStart: "yyyy-MM-dd",
 *   weekRange: "Sep 21 – Sep 27",
 *   weekLabel: "Week of Sep 21 – Sep 27",
 *   recipients: [{ id, name, emailMasked }],
 *   skipped: [{ id, name, reason }]
 * }
 * reason is "No email" or "Invalid email". Ids 105, 909, and 911 are omitted.
 *
 * Send JSON:
 * {
 *   success: true,
 *   weekStart, weekRange, weekLabel,
 *   sentCount, failedCount,
 *   results: [{ id, name, status: "sent" } | { id, name, status: "failed", error }],
 *   skipped: [{ id, name, reason }]
 * }
 * Full email addresses are not returned. One email is sent to each player,
 * and the body contains only that player's scorecard.
 */

var SCORECARD_EMAIL_DEFAULT_FROM_ = 'Thunder 13A <scorecards@players.coachinghockey.ca>';
var SCORECARD_EMAIL_EXCLUDED_ = { '105': true, '909': true, '911': true };

function previewScorecardEmails_(weekStart) {
  var prepared = scorecardEmailPrepare_(weekStart);
  if (!prepared.success) return prepared;
  var recipients = [];
  for (var i = 0; i < prepared.recipients.length; i++) {
    var player = prepared.recipients[i];
    recipients.push({
      id: player.id,
      name: player.name,
      emailMasked: scorecardEmailMask_(player.email)
    });
  }
  return {
    success: true,
    weekStart: prepared.weekStart,
    weekRange: prepared.weekRange,
    weekLabel: prepared.weekLabel,
    recipients: recipients,
    skipped: prepared.skipped
  };
}

function sendAllScorecards_(sendKey, weekStart) {
  var keyCheck = scorecardEmailSendKeyOk_(sendKey);
  if (!keyCheck.ok) return scorecardEmailFail_(keyCheck.message, 'UNAUTHORIZED');

  var prepared = scorecardEmailPrepare_(weekStart);
  if (!prepared.success) return prepared;

  var base = {
    success: true,
    weekStart: prepared.weekStart,
    weekRange: prepared.weekRange,
    weekLabel: prepared.weekLabel,
    sentCount: 0,
    failedCount: 0,
    results: [],
    skipped: prepared.skipped
  };
  if (!prepared.recipients.length) return base;

  var props = PropertiesService.getScriptProperties();
  var apiKey = scorecardEmailTrim_(props.getProperty('RESEND_API_KEY'));
  if (!apiKey) {
    return scorecardEmailFail_('Set the RESEND_API_KEY script property, then try again.', 'MISSING_API_KEY');
  }
  var from = scorecardEmailTrim_(props.getProperty('RESEND_FROM'));
  if (!from) from = SCORECARD_EMAIL_DEFAULT_FROM_;

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(15000);
  } catch (err) {
    return scorecardEmailFail_('Could not start the send. Try again in a moment.', 'BUSY');
  }
  if (!locked) {
    return scorecardEmailFail_('A send is already running. Wait for it to finish, then try again.', 'BUSY');
  }

  try {
    var results = [];
    var sentCount = 0;
    var failedCount = 0;
    for (var i = 0; i < prepared.recipients.length; i++) {
      var recipient = prepared.recipients[i];
      var subject = scorecardEmailSubject_(recipient.name, prepared.weekRange);
      var html = scorecardEmailHtml_(recipient.card);
      var text = scorecardEmailText_(recipient.card);
      var outcome;
      try {
        outcome = scorecardEmailPost_(apiKey, from, recipient.email, subject, html, text);
      } catch (err) {
        outcome = {
          ok: false,
          error: scorecardEmailClip_(err && err.message ? String(err.message) : String(err))
        };
      }
      if (outcome.ok) {
        sentCount++;
        results.push({ id: recipient.id, name: recipient.name, status: 'sent' });
      } else {
        failedCount++;
        results.push({
          id: recipient.id,
          name: recipient.name,
          status: 'failed',
          error: outcome.error || 'The email could not be sent.'
        });
      }
      // Resend allows about 2 requests per second. Sleep between calls, not
      // in parallel, so a full roster does not burst past that limit.
      if (i < prepared.recipients.length - 1) Utilities.sleep(500);
    }
    base.sentCount = sentCount;
    base.failedCount = failedCount;
    base.results = results;
    return base;
  } finally {
    try {
      lock.releaseLock();
    } catch (ignore) {}
  }
}

function scorecardEmailFail_(message, code) {
  return {
    success: false,
    code: code || 'SCORECARDS_ERROR',
    message: message
  };
}

function scorecardEmailTrim_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/^\s+|\s+$/g, '');
}

function scorecardEmailClip_(text) {
  var value = scorecardEmailTrim_(text).replace(/[\r\n]+/g, ' ');
  if (value.length > 280) return value.substring(0, 277) + '...';
  return value;
}

function scorecardEmailSendKeyOk_(sendKey) {
  var expected = scorecardEmailTrim_(PropertiesService.getScriptProperties().getProperty('SCORECARD_SEND_KEY'));
  var given = scorecardEmailTrim_(sendKey);
  if (!expected) {
    return {
      ok: false,
      message: 'Set the SCORECARD_SEND_KEY script property to a passphrase, then try again.'
    };
  }
  if (!given || given !== expected) {
    return { ok: false, message: 'The send key does not match.' };
  }
  return { ok: true };
}

function scorecardEmailPrepare_(weekStart) {
  if (typeof getTeamScorecards_ !== 'function') {
    return scorecardEmailFail_('Paste scorecards.gs first so getTeamScorecards_() is available.');
  }
  var data;
  try {
    data = getTeamScorecards_();
  } catch (err) {
    return scorecardEmailFail_(err && err.message ? String(err.message) : String(err));
  }
  if (!data || data.success !== true || !data.players) {
    if (data && data.success === false) return data;
    return scorecardEmailFail_('Team scorecards could not be read.');
  }

  var emails = scorecardEmailMap_();
  if (emails.error) return scorecardEmailFail_(emails.error);

  var today = scorecardEmailTodayYmd_();
  var week = scorecardEmailResolveWeek_(weekStart, today);
  if (week.error) return scorecardEmailFail_(week.error);

  var players = data.players;
  var overallMondays = scorecardEmailOverallMondays_(players, today);
  var recipients = [];
  var skipped = [];
  for (var i = 0; i < players.length; i++) {
    var player = players[i];
    var id = scorecardEmailTrim_(player.id);
    if (!id || SCORECARD_EMAIL_EXCLUDED_[id]) continue;
    var name = scorecardEmailDisplayName_(player);
    var email = emails.map[id] || '';
    if (!email) {
      skipped.push({ id: id, name: name, reason: 'No email' });
      continue;
    }
    if (!scorecardEmailValid_(email)) {
      skipped.push({ id: id, name: name, reason: 'Invalid email' });
      continue;
    }
    recipients.push({
      id: id,
      name: name,
      email: email,
      card: scorecardEmailCard_(player, data.strategyTotal, overallMondays, week.weekMonday)
    });
  }

  return {
    success: true,
    weekStart: week.weekMonday,
    weekRange: scorecardEmailWeekRange_(week.weekMonday),
    weekLabel: scorecardEmailWeekLabel_(week.weekMonday),
    recipients: recipients,
    skipped: skipped
  };
}

function scorecardEmailTodayYmd_() {
  return Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd');
}

function scorecardEmailResolveWeek_(weekStart, todayYmd) {
  var currentMonday = scorecardEmailMondayOf_(todayYmd);
  var lastCompleted = scorecardEmailAddDays_(currentMonday, -7);
  var raw = scorecardEmailTrim_(weekStart);
  if (!raw) return { weekMonday: lastCompleted };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { error: 'weekStart must be a Monday as yyyy-MM-dd.' };
  }
  var parts = raw.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  var stamp = new Date(Date.UTC(year, month - 1, day));
  if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) {
    return { error: 'weekStart must be a Monday as yyyy-MM-dd.' };
  }
  if (scorecardEmailMondayOf_(raw) !== raw) {
    return { error: 'weekStart must be a Monday as yyyy-MM-dd.' };
  }
  if (raw > currentMonday) return { error: 'That week has not started yet.' };
  return { weekMonday: raw };
}

function scorecardEmailOverallMondays_(players, todayYmd) {
  var currentMonday = scorecardEmailMondayOf_(todayYmd);
  var lastCompleted = scorecardEmailAddDays_(currentMonday, -7);
  var earliest = '';
  for (var i = 0; i < players.length; i++) {
    var dates = scorecardEmailUniqueDates_(players[i].workoutDates).concat(scorecardEmailUniqueDates_(players[i].skillsDates));
    for (var d = 0; d < dates.length; d++) {
      if (!earliest || dates[d] < earliest) earliest = dates[d];
    }
  }
  if (!earliest) return [];
  return scorecardEmailListWeekMondays_(scorecardEmailMondayOf_(earliest), lastCompleted);
}

function scorecardEmailAddDays_(ymd, n) {
  var parts = String(ymd).split('-');
  var dt = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10) + n));
  var month = dt.getUTCMonth() + 1;
  var day = dt.getUTCDate();
  return dt.getUTCFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
}

function scorecardEmailMondayOf_(ymd) {
  var parts = String(ymd).split('-');
  var day = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))).getUTCDay();
  var delta = day === 0 ? -6 : 1 - day;
  return scorecardEmailAddDays_(ymd, delta);
}

function scorecardEmailListWeekMondays_(startMonday, endMonday) {
  var weeks = [];
  if (!startMonday || !endMonday || startMonday > endMonday) return weeks;
  var cursor = startMonday;
  while (cursor <= endMonday && weeks.length < 520) {
    weeks.push(cursor);
    cursor = scorecardEmailAddDays_(cursor, 7);
  }
  return weeks;
}

function scorecardEmailNormalizeYmd_(value) {
  var match = String(value || '').replace(/^\s+|\s+$/g, '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function scorecardEmailUniqueDates_(values) {
  var seen = {};
  var list = values || [];
  for (var i = 0; i < list.length; i++) {
    var ymd = scorecardEmailNormalizeYmd_(list[i]);
    if (ymd) seen[ymd] = true;
  }
  var keys = [];
  for (var key in seen) {
    if (Object.prototype.hasOwnProperty.call(seen, key)) keys.push(key);
  }
  keys.sort();
  return keys;
}

function scorecardEmailCountInWeek_(dates, monday) {
  var sunday = scorecardEmailAddDays_(monday, 6);
  var unique = scorecardEmailUniqueDates_(dates);
  var count = 0;
  for (var i = 0; i < unique.length; i++) {
    if (unique[i] >= monday && unique[i] <= sunday) count++;
  }
  return count;
}

function scorecardEmailWorkoutWeekFraction_(player, monday) {
  return scorecardEmailCountInWeek_(player.workoutDates, monday) >= 1 ? 1 : 0;
}

function scorecardEmailSkillsWeekFraction_(player, monday) {
  return Math.min(scorecardEmailCountInWeek_(player.skillsDates, monday), 2) / 2;
}

function scorecardEmailAverage_(values) {
  if (!values || !values.length) return null;
  var sum = 0;
  for (var i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function scorecardEmailStrategyFraction_(player, strategyTotal) {
  var total = Number(strategyTotal);
  if (!isFinite(total) || total <= 0) return null;
  var ids = {};
  var list = player.strategyCompleted || [];
  for (var i = 0; i < list.length; i++) {
    var key = scorecardEmailTrim_(list[i]);
    if (key) ids[key] = true;
  }
  var count = 0;
  for (var id in ids) {
    if (Object.prototype.hasOwnProperty.call(ids, id)) count++;
  }
  return count / total;
}

function scorecardEmailAttendanceFraction_(player) {
  var attendance = player.attendance;
  if (!attendance) return null;
  var total = Number(attendance.total);
  var attended = Number(attendance.attended);
  if (!isFinite(total) || total <= 0 || !isFinite(attended)) return null;
  return attended / total;
}

function scorecardEmailAttendanceDetail_(player) {
  var attendance = player.attendance;
  if (!attendance) return 'Attendance sheet is not available yet';
  var total = Number(attendance.total);
  if (!isFinite(total) || total <= 0) return 'No events recorded';
  var attended = Number(attendance.attended);
  var away = Number(attendance.away);
  return (isFinite(attended) ? attended : 0) + ' of ' + total + ' events \u00b7 ' + (isFinite(away) ? away : 0) + ' away';
}

function scorecardEmailFormatPct_(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return '\u2014';
  var rounded = Math.round(fraction * 1000) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded)) + '%';
  return rounded.toFixed(1) + '%';
}

function scorecardEmailFormatMonthDay_(ymd) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var parts = String(ymd).split('-');
  return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
}

function scorecardEmailWeekRange_(monday) {
  return scorecardEmailFormatMonthDay_(monday) + ' \u2013 ' + scorecardEmailFormatMonthDay_(scorecardEmailAddDays_(monday, 6));
}

function scorecardEmailWeekLabel_(monday) {
  return 'Week of ' + scorecardEmailWeekRange_(monday);
}

function scorecardEmailDisplayName_(player) {
  var name = String(player && player.name || '').replace(/[\r\n]+/g, ' ').replace(/^\s+|\s+$/g, '');
  return name || 'Unnamed';
}

function scorecardEmailCard_(player, strategyTotal, overallMondays, weekMonday) {
  var workoutValues = [];
  var skillsValues = [];
  for (var i = 0; i < overallMondays.length; i++) {
    workoutValues.push(scorecardEmailWorkoutWeekFraction_(player, overallMondays[i]));
    skillsValues.push(scorecardEmailSkillsWeekFraction_(player, overallMondays[i]));
  }
  var completedCount = (player.strategyCompleted || []).length;
  var totalShown = Number(strategyTotal);
  if (!isFinite(totalShown)) totalShown = 0;
  var jerseyRaw = player.jersey == null ? '' : scorecardEmailTrim_(player.jersey);
  var skillDays = scorecardEmailCountInWeek_(player.skillsDates, weekMonday);
  return {
    name: scorecardEmailDisplayName_(player),
    jerseyLabel: jerseyRaw ? ('#' + jerseyRaw) : '#??',
    weekLabel: scorecardEmailWeekLabel_(weekMonday),
    weekRange: scorecardEmailWeekRange_(weekMonday),
    strategy: scorecardEmailStrategyFraction_(player, strategyTotal),
    strategyDetail: completedCount + ' of ' + totalShown + ' lessons',
    workoutOverall: scorecardEmailAverage_(workoutValues),
    workoutOverallDetail: overallMondays.length ? ('Average of ' + overallMondays.length + ' completed weeks') : 'No completed weeks yet',
    skillsOverall: scorecardEmailAverage_(skillsValues),
    skillsOverallDetail: 'Up to 2 skill days count each week',
    attendance: scorecardEmailAttendanceFraction_(player),
    attendanceDetail: scorecardEmailAttendanceDetail_(player),
    workoutWeek: scorecardEmailWorkoutWeekFraction_(player, weekMonday),
    workoutWeekDetail: '100% once any workout day is checked',
    skillsWeek: scorecardEmailSkillsWeekFraction_(player, weekMonday),
    skillsWeekDetail: skillDays + ' skill day' + (skillDays === 1 ? '' : 's') + ' this week'
  };
}

function scorecardEmailValid_(email) {
  if (!email || email.length > 254) return false;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

function scorecardEmailMask_(email) {
  var parts = String(email || '').split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '***';
  return parts[0].charAt(0) + '***@' + parts[1];
}

function scorecardEmailSubject_(name, weekRange) {
  var safeName = scorecardEmailClip_(name) || 'Player';
  return safeName + ' \u2014 Thunder 13A Scorecard (Week of ' + weekRange + ')';
}

function scorecardEmailEscapeHtml_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch];
  });
}

function scorecardEmailBarColor_(kind) {
  if (kind === 'strategy') return '#818cf8';
  if (kind === 'workout') return '#34d399';
  if (kind === 'skills') return '#fbbf24';
  return '#22d3ee';
}

function scorecardEmailValueColor_(fraction) {
  if (fraction === null || fraction === undefined || !isFinite(fraction)) return '#94a3b8';
  var pct = fraction * 100;
  if (pct >= 80) return '#34d399';
  if (pct >= 50) return '#fbbf24';
  return '#fb7185';
}

function scorecardEmailBarTable_(fraction, kind) {
  var pct = 0;
  if (fraction !== null && fraction !== undefined && isFinite(fraction)) {
    pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }
  var color = scorecardEmailBarColor_(kind);
  if (pct <= 0) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#1e293b;border-radius:999px;">'
      + '<tr><td height="10" bgcolor="#1e293b" style="height:10px;font-size:0;line-height:0;background-color:#1e293b;">&nbsp;</td></tr></table>';
  }
  if (pct >= 100) {
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:' + color + ';border-radius:999px;">'
      + '<tr><td height="10" bgcolor="' + color + '" style="height:10px;font-size:0;line-height:0;background-color:' + color + ';">&nbsp;</td></tr></table>';
  }
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#1e293b;border-radius:999px;">'
    + '<tr>'
    + '<td width="' + pct + '%" height="10" bgcolor="' + color + '" style="width:' + pct + '%;height:10px;font-size:0;line-height:0;background-color:' + color + ';border-radius:999px 0 0 999px;">&nbsp;</td>'
    + '<td width="' + (100 - pct) + '%" height="10" bgcolor="#1e293b" style="width:' + (100 - pct) + '%;height:10px;font-size:0;line-height:0;background-color:#1e293b;border-radius:0 999px 999px 0;">&nbsp;</td>'
    + '</tr></table>';
}

function scorecardEmailMetricRow_(label, fraction, kind, detail) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 14px;">'
    + '<tr>'
    + '<td align="left" valign="baseline" style="padding:0 12px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:#e2e8f0;">' + scorecardEmailEscapeHtml_(label) + '</td>'
    + '<td align="right" valign="baseline" style="padding:0 0 6px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:bold;color:' + scorecardEmailValueColor_(fraction) + ';">' + scorecardEmailEscapeHtml_(scorecardEmailFormatPct_(fraction)) + '</td>'
    + '</tr>'
    + '<tr><td colspan="2" style="padding:0;">' + scorecardEmailBarTable_(fraction, kind) + '</td></tr>'
    + '<tr><td colspan="2" style="padding:5px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:15px;color:#94a3b8;">' + scorecardEmailEscapeHtml_(detail) + '</td></tr>'
    + '</table>';
}

function scorecardEmailSection_(title, rowsHtml) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:18px 0 0;border-top:1px solid #1e293b;">'
    + '<tr><td style="padding:14px 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;letter-spacing:0.14em;text-transform:uppercase;font-weight:bold;color:#94a3b8;">' + scorecardEmailEscapeHtml_(title) + '</td></tr>'
    + '<tr><td style="padding:0;">' + rowsHtml + '</td></tr>'
    + '</table>';
}

function scorecardEmailHtml_(card) {
  var overall = scorecardEmailMetricRow_('Strategy', card.strategy, 'strategy', card.strategyDetail)
    + scorecardEmailMetricRow_('Workout', card.workoutOverall, 'workout', card.workoutOverallDetail)
    + scorecardEmailMetricRow_('Skills', card.skillsOverall, 'skills', card.skillsOverallDetail)
    + scorecardEmailMetricRow_('Attendance', card.attendance, 'attendance', card.attendanceDetail);
  var week = scorecardEmailMetricRow_('Workout', card.workoutWeek, 'workout', card.workoutWeekDetail)
    + scorecardEmailMetricRow_('Skills', card.skillsWeek, 'skills', card.skillsWeekDetail);
  var preheader = 'Your Thunder 13A scorecard for the week of ' + card.weekRange + '.';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>'
    + scorecardEmailEscapeHtml_(card.name) + ' \u2014 Thunder 13A Scorecard</title></head>'
    + '<body style="margin:0;padding:0;background-color:#0b1329;">'
    + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0b1329;">' + scorecardEmailEscapeHtml_(preheader) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#0b1329;">'
    + '<tr><td align="center" style="padding:24px 12px;">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;border-collapse:separate;background-color:#0f172a;border:1px solid #334155;border-radius:18px;">'
    + '<tr><td style="padding:28px 28px 22px;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">'
    + '<p style="margin:0;font-size:11px;line-height:14px;letter-spacing:0.16em;text-transform:uppercase;color:#a5b4fc;font-weight:bold;">Thunder Bowl</p>'
    + '<p style="margin:4px 0 0;font-size:13px;line-height:18px;color:#94a3b8;font-weight:bold;">Player scorecard</p>'
    + '<p style="margin:18px 0 0;font-size:28px;line-height:32px;font-weight:800;color:#f8fafc;letter-spacing:-0.02em;">' + scorecardEmailEscapeHtml_(card.name) + '</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-collapse:separate;">'
    + '<tr><td style="background-color:#1e1b4b;color:#c7d2fe;border:1px solid #4338ca;border-radius:999px;padding:3px 10px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:16px;font-weight:bold;">Jersey ' + scorecardEmailEscapeHtml_(card.jerseyLabel) + '</td></tr>'
    + '</table>'
    + scorecardEmailSection_('Overall', overall)
    + scorecardEmailSection_(card.weekLabel, week)
    + '<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:#64748b;">Weeks are Monday to Sunday, America/Toronto. Overall workout and skills skip the week until it is finished. This email shows only your scorecard.</p>'
    + '</td></tr></table>'
    + '</td></tr></table></body></html>';
}

function scorecardEmailText_(card) {
  return [
    'Thunder Bowl',
    'Player scorecard',
    card.name,
    'Jersey ' + card.jerseyLabel,
    '',
    'Overall',
    'Strategy: ' + scorecardEmailFormatPct_(card.strategy) + ' (' + card.strategyDetail + ')',
    'Workout: ' + scorecardEmailFormatPct_(card.workoutOverall) + ' (' + card.workoutOverallDetail + ')',
    'Skills: ' + scorecardEmailFormatPct_(card.skillsOverall) + ' (' + card.skillsOverallDetail + ')',
    'Attendance: ' + scorecardEmailFormatPct_(card.attendance) + ' (' + card.attendanceDetail + ')',
    '',
    card.weekLabel,
    'Workout: ' + scorecardEmailFormatPct_(card.workoutWeek) + ' (' + card.workoutWeekDetail + ')',
    'Skills: ' + scorecardEmailFormatPct_(card.skillsWeek) + ' (' + card.skillsWeekDetail + ')',
    '',
    'Weeks are Monday to Sunday, America/Toronto. Overall workout and skills skip the week until it is finished.',
    'This email shows only your scorecard.'
  ].join('\n');
}

function scorecardEmailPost_(apiKey, from, to, subject, html, text) {
  var response = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      from: from,
      to: [to],
      subject: subject,
      html: html,
      text: text
    }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true };
  var message = 'The email provider returned status ' + code + '.';
  try {
    var parsed = JSON.parse(response.getContentText() || '');
    if (parsed && typeof parsed.message === 'string' && parsed.message) {
      message = parsed.message;
    } else if (parsed && typeof parsed.error === 'string' && parsed.error) {
      message = parsed.error;
    } else if (parsed && parsed.error && parsed.error.message) {
      message = String(parsed.error.message);
    }
  } catch (ignore) {}
  return { ok: false, error: scorecardEmailClip_(message) };
}

function scorecardEmailNormHeader_(value) {
  return String(value || '').replace(/^\s+|\s+$/g, '').toLowerCase().replace(/[\s_]+/g, '');
}

function scorecardEmailId_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && isFinite(value)) {
    if (Math.round(value) === value) return String(Math.round(value));
    return String(value);
  }
  var text = String(value).replace(/^\s+|\s+$/g, '');
  if (/^-?\d+\.0+$/.test(text)) return String(parseInt(text, 10));
  return text;
}

function scorecardEmailAsText_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && isFinite(value)) {
    if (Math.round(value) === value) return String(Math.round(value));
    return String(value);
  }
  return String(value).replace(/^\s+|\s+$/g, '');
}

function scorecardEmailRowBlank_(row) {
  for (var i = 0; i < row.length; i++) {
    if (scorecardEmailAsText_(row[i]) !== '') return false;
  }
  return true;
}

function scorecardEmailSheetByName_(ss, name) {
  var exact = ss.getSheetByName(name);
  if (exact) return exact;
  var want = String(name).toLowerCase();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getName()).replace(/^\s+|\s+$/g, '').toLowerCase() === want) return sheets[i];
  }
  return null;
}

function scorecardEmailMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { error: 'This script must stay bound to the hockeyDB spreadsheet.' };
  var sheet = scorecardEmailSheetByName_(ss, 'players');
  if (!sheet) return { error: 'The players tab is missing.' };
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return { error: 'The players tab is empty.' };

  var index = {};
  var headerRow = values[0];
  for (var c = 0; c < headerRow.length; c++) {
    var key = scorecardEmailNormHeader_(headerRow[c]);
    if (key && !Object.prototype.hasOwnProperty.call(index, key)) index[key] = c;
  }

  var idCol = index.id;
  if (idCol === undefined) idCol = index.playerid;
  var emailCol = index.email;
  if (emailCol === undefined) emailCol = index['e-mail'];
  if (emailCol === undefined) emailCol = index.emailaddress;
  if (emailCol === undefined) emailCol = index.playeremail;
  if (idCol === undefined) return { error: 'The players tab needs an id column.' };
  if (emailCol === undefined) return { error: 'The players tab needs an email column (header: email).' };

  var map = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (scorecardEmailRowBlank_(row)) continue;
    var pid = scorecardEmailId_(row[idCol]);
    if (!pid || Object.prototype.hasOwnProperty.call(map, pid)) continue;
    var raw = emailCol >= row.length ? '' : row[emailCol];
    map[pid] = scorecardEmailAsText_(raw);
  }
  return { map: map };
}
