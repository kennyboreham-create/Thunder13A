/**
 * READ-ONLY team scorecards for scorecards.html.
 *
 * Paste this entire file into the Apps Script project that is bound to the
 * Google Sheet "hockeyDB" (Extensions > Apps Script > New file, or paste at
 * the bottom of an existing script file). The only new global is
 * getTeamScorecards_(). Do not replace doGet, and do not edit any existing
 * function. Nothing in this file writes to the spreadsheet.
 *
 * Add this ONE line inside the existing doGet(e) action switch, beside the
 * other action checks. Leave every existing branch unchanged:
 *
 * if (action === 'getTeamScorecards') return ContentService.createTextOutput(JSON.stringify(getTeamScorecards_())).setMimeType(ContentService.MimeType.JSON);
 *
 * Redeploy so the new version is live: Deploy > Manage deployments > edit
 * (pencil) > Version: New version > Deploy. New version keeps the same URL.
 *
 * JSON shape:
 * {
 *   success: true,
 *   strategyTotal: number,          // distinct current lessons with category Strategy
 *   players: [{
 *     id: string,
 *     name: string,
 *     jersey: string,
 *     strategyCompleted: string[],  // distinct lesson ids that are in that Strategy list
 *     workoutDates: string[],       // distinct America/Toronto yyyy-MM-dd with any workout check
 *     skillsDates: string[],        // distinct America/Toronto yyyy-MM-dd with any skills check
 *     attendance: { attended: number, away: number, total: number } | null
 *   }]
 * }
 * attendance is null on every player when the attendance tab does not exist.
 * Passwords are never read and never returned. Player ids 105, 909, and 911
 * (staff/test accounts) are omitted.
 */
// Add this ONE line inside the existing doGet(e) action switch. Do not change any other branch:
// if (action === 'getTeamScorecards') return ContentService.createTextOutput(JSON.stringify(getTeamScorecards_())).setMimeType(ContentService.MimeType.JSON);

function getTeamScorecards_() {
  var TZ = 'America/Toronto';
  var EXCLUDED = { '105': true, '909': true, '911': true };
  var IGNORED_LESSONS = { 'L_WEEKLY_WORKOUT': true, 'L_DAILY_SKILLS': true };

  function fail_(message) {
    return { success: false, code: 'SCORECARDS_ERROR', message: message };
  }

  function normHeader_(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '').toLowerCase().replace(/[\s_]+/g, '');
  }

  function idString_(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && isFinite(value)) {
      if (Math.round(value) === value) return String(Math.round(value));
      return String(value);
    }
    var text = String(value).replace(/^\s+|\s+$/g, '');
    if (/^-?\d+\.0+$/.test(text)) return String(parseInt(text, 10));
    return text;
  }

  function asText_(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && isFinite(value)) {
      if (Math.round(value) === value) return String(Math.round(value));
      return String(value);
    }
    return String(value).replace(/^\s+|\s+$/g, '');
  }

  function numOrZero_(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' && isFinite(value)) return value;
    var n = parseFloat(String(value).replace(/^\s+|\s+$/g, ''));
    return isFinite(n) ? n : 0;
  }

  function isDate_(value) {
    return Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
  }

  function torontoYmd_(value) {
    if (isDate_(value)) {
      return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
    }
    if (typeof value === 'string') {
      var trimmed = value.replace(/^\s+|\s+$/g, '');
      if (!trimmed) return '';
      var iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
      if (iso) return iso[1];
      var parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return Utilities.formatDate(parsed, TZ, 'yyyy-MM-dd');
      }
    }
    return '';
  }

  function sheetByName_(ss, name) {
    var exact = ss.getSheetByName(name);
    if (exact) return exact;
    var want = String(name).toLowerCase();
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (String(sheets[i].getName()).replace(/^\s+|\s+$/g, '').toLowerCase() === want) {
        return sheets[i];
      }
    }
    return null;
  }

  function readSheet_(ss, name) {
    var sheet = sheetByName_(ss, name);
    if (!sheet) return null;
    var values = sheet.getDataRange().getValues();
    if (!values || !values.length) return { index: {}, rows: [] };
    var index = {};
    var headerRow = values[0];
    for (var c = 0; c < headerRow.length; c++) {
      var key = normHeader_(headerRow[c]);
      if (key && !Object.prototype.hasOwnProperty.call(index, key)) index[key] = c;
    }
    return { index: index, rows: values.slice(1) };
  }

  function col_(sheetData, aliases) {
    if (!sheetData) return -1;
    for (var i = 0; i < aliases.length; i++) {
      if (Object.prototype.hasOwnProperty.call(sheetData.index, aliases[i])) {
        return sheetData.index[aliases[i]];
      }
    }
    return -1;
  }

  function cell_(row, idx) {
    if (idx < 0 || !row || idx >= row.length) return '';
    return row[idx];
  }

  function rowBlank_(row) {
    for (var i = 0; i < row.length; i++) {
      if (asText_(row[i]) !== '') return false;
    }
    return true;
  }

  function sortedKeys_(obj) {
    var keys = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) keys.push(k);
    }
    keys.sort();
    return keys;
  }

  function addSet_(map, key) {
    if (!key) return;
    map[key] = true;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return fail_('This script must stay bound to the hockeyDB spreadsheet.');
    }

    var playersSheet = readSheet_(ss, 'players');
    var lessonsSheet = readSheet_(ss, 'lessons');
    var progressSheet = readSheet_(ss, 'player_progress');
    var attendanceSheet = readSheet_(ss, 'attendance');

    if (!playersSheet) return fail_('The players tab is missing.');
    if (!lessonsSheet) return fail_('The lessons tab is missing.');
    if (!progressSheet) return fail_('The player_progress tab is missing.');

    var playerIdCol = col_(playersSheet, ['id', 'playerid']);
    var playerNameCol = col_(playersSheet, ['name', 'playername']);
    var playerJerseyCol = col_(playersSheet, ['jerseynumber', 'jersey', 'number']);
    if (playerIdCol < 0 || playerNameCol < 0) {
      return fail_('The players tab needs id and name columns.');
    }

    var lessonIdCol = col_(lessonsSheet, ['id', 'lessonid']);
    var lessonCategoryCol = col_(lessonsSheet, ['category']);
    if (lessonIdCol < 0 || lessonCategoryCol < 0) {
      return fail_('The lessons tab needs id and category columns.');
    }

    var progressPlayerCol = col_(progressSheet, ['playerid', 'player']);
    var progressTypeCol = col_(progressSheet, ['activitytype', 'type']);
    var progressActivityCol = col_(progressSheet, ['activityid']);
    var progressTimeCol = col_(progressSheet, ['timestamp', 'date', 'datetime']);
    if (progressPlayerCol < 0 || progressTypeCol < 0 || progressActivityCol < 0 || progressTimeCol < 0) {
      return fail_('The player_progress tab needs player_id, activity_type, activity_id, and timestamp columns.');
    }

    var attendanceByPlayer = null;
    if (attendanceSheet) {
      var attPlayerCol = col_(attendanceSheet, ['playerid', 'player', 'id']);
      var attAttendedCol = col_(attendanceSheet, ['attended']);
      var attAwayCol = col_(attendanceSheet, ['away']);
      var attTotalCol = col_(attendanceSheet, ['totalevents', 'total', 'events']);
      if (attPlayerCol < 0 || attAttendedCol < 0 || attTotalCol < 0) {
        return fail_('The attendance tab needs player id, attended, and total events columns. Header names are matched case-insensitively.');
      }
      attendanceByPlayer = {};
      for (var a = 0; a < attendanceSheet.rows.length; a++) {
        var attRow = attendanceSheet.rows[a];
        if (rowBlank_(attRow)) continue;
        var attId = idString_(cell_(attRow, attPlayerCol));
        if (!attId || EXCLUDED[attId]) continue;
        attendanceByPlayer[attId] = {
          attended: numOrZero_(cell_(attRow, attAttendedCol)),
          away: attAwayCol < 0 ? 0 : numOrZero_(cell_(attRow, attAwayCol)),
          total: numOrZero_(cell_(attRow, attTotalCol))
        };
      }
    }

    var strategySet = {};
    var strategyCount = 0;
    for (var l = 0; l < lessonsSheet.rows.length; l++) {
      var lessonRow = lessonsSheet.rows[l];
      if (rowBlank_(lessonRow)) continue;
      var lessonId = idString_(cell_(lessonRow, lessonIdCol));
      if (!lessonId) continue;
      if (IGNORED_LESSONS[lessonId.toUpperCase()]) continue;
      var category = asText_(cell_(lessonRow, lessonCategoryCol)).toLowerCase();
      if (category !== 'strategy') continue;
      if (!strategySet[lessonId]) {
        strategySet[lessonId] = true;
        strategyCount++;
      }
    }

    var completedByPlayer = {};
    var workoutByPlayer = {};
    var skillsByPlayer = {};

    for (var p = 0; p < progressSheet.rows.length; p++) {
      var progRow = progressSheet.rows[p];
      if (rowBlank_(progRow)) continue;
      var progressPlayerId = idString_(cell_(progRow, progressPlayerCol));
      if (!progressPlayerId || EXCLUDED[progressPlayerId]) continue;

      var activityType = asText_(cell_(progRow, progressTypeCol)).toUpperCase();
      var activityId = asText_(cell_(progRow, progressActivityCol));
      if (!activityId) continue;

      if (activityType === 'LESSON_COMPLETED') {
        var lessonKey = idString_(activityId);
        if (strategySet[lessonKey]) {
          if (!completedByPlayer[progressPlayerId]) completedByPlayer[progressPlayerId] = {};
          addSet_(completedByPlayer[progressPlayerId], lessonKey);
        }
        continue;
      }

      if (activityType !== 'COMPLETED_DASHBOARD_TRACKER') continue;

      var prefix = activityId.toUpperCase();
      var isWorkout = prefix.indexOf('WORKOUT_') === 0;
      var isSkills = prefix.indexOf('SKILLS_') === 0;
      if (!isWorkout && !isSkills) continue;

      var ymd = torontoYmd_(cell_(progRow, progressTimeCol));
      if (!ymd) continue;

      if (isWorkout) {
        if (!workoutByPlayer[progressPlayerId]) workoutByPlayer[progressPlayerId] = {};
        addSet_(workoutByPlayer[progressPlayerId], ymd);
      } else {
        if (!skillsByPlayer[progressPlayerId]) skillsByPlayer[progressPlayerId] = {};
        addSet_(skillsByPlayer[progressPlayerId], ymd);
      }
    }

    var players = [];
    var seenPlayers = {};
    for (var r = 0; r < playersSheet.rows.length; r++) {
      var playerRow = playersSheet.rows[r];
      if (rowBlank_(playerRow)) continue;
      var pid = idString_(cell_(playerRow, playerIdCol));
      if (!pid || EXCLUDED[pid] || seenPlayers[pid]) continue;
      seenPlayers[pid] = true;

      var attendance = null;
      if (attendanceByPlayer) {
        attendance = attendanceByPlayer[pid] || { attended: 0, away: 0, total: 0 };
      }

      players.push({
        id: pid,
        name: asText_(cell_(playerRow, playerNameCol)),
        jersey: playerJerseyCol < 0 ? '' : asText_(cell_(playerRow, playerJerseyCol)),
        strategyCompleted: sortedKeys_(completedByPlayer[pid] || {}),
        workoutDates: sortedKeys_(workoutByPlayer[pid] || {}),
        skillsDates: sortedKeys_(skillsByPlayer[pid] || {}),
        attendance: attendance
      });
    }

    players.sort(function (a, b) {
      var aj = parseFloat(a.jersey);
      var bj = parseFloat(b.jersey);
      var aNum = isFinite(aj);
      var bNum = isFinite(bj);
      if (aNum && bNum && aj !== bj) return aj - bj;
      if (aNum !== bNum) return aNum ? -1 : 1;
      var an = a.name.toLowerCase();
      var bn = b.name.toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });

    return {
      success: true,
      strategyTotal: strategyCount,
      players: players
    };
  } catch (err) {
    return fail_(err && err.message ? String(err.message) : String(err));
  }
}
