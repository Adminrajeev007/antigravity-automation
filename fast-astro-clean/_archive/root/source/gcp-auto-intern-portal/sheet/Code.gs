/**
 * GCP Auto Intern Portal — QR email -> Google Sheet
 *
 * One row per email. The extension only ever calls action=qr (upsert), so an
 * email is added only when its QR is generated. Status is updated horizontally
 * by any consumer calling reserve / success / reject.
 *
 * Setup:
 *  1. Open your Google Sheet -> Extensions -> Apps Script.
 *  2. Paste this file, change SCRIPT_TOKEN below.
 *  3. Deploy -> New deployment -> Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. Copy the /exec URL and paste it (with the same token) into the extension popup.
 */

var SCRIPT_TOKEN = "change-this-sheet-token";
var DEFAULT_TAB = "QR";
var HEADERS = [
  "Created",
  "Email",
  "QR Generated",
  "Last Operation",
  "Status",
  "Token",
  "Reserved",
  "Successful",
  "Rejected",
  "Notes"
];
var COL = {
  created: 1,
  email: 2,
  qr: 3,
  last: 4,
  status: 5,
  token: 6,
  reserved: 7,
  successful: 8,
  rejected: 9,
  notes: 10
};

function doPost(e) {
  return handle_(e);
}

function doGet(e) {
  return handle_(e);
}

function handle_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: "busy" });
  }
  try {
    var p = parse_(e);
    var auth = String(p.token || p.key || "");
    if (SCRIPT_TOKEN && auth !== SCRIPT_TOKEN) {
      return json_({ ok: false, error: "unauthorized" });
    }

    var action = String(p.action || "list").toLowerCase();
    var tab = String(p.tab || DEFAULT_TAB);

    if (action === "health" || action === "ping") {
      return json_({ ok: true, time: now_(), tab: tab });
    }
    if (action === "qr" || action === "upsert" || action === "add") {
      return upsert_(tab, p);
    }
    if (action === "reserve" || action === "reserved") {
      return mark_(tab, p, "reserved");
    }
    if (action === "success" || action === "successful") {
      return mark_(tab, p, "successful");
    }
    if (action === "reject" || action === "rejected" || action === "fail" || action === "failed") {
      return mark_(tab, p, "rejected");
    }
    if (action === "note" || action === "picked") {
      return note_(tab, p);
    }
    if (action === "complete" || action === "completed") {
      return complete_(tab, p);
    }
    if (action === "reset") {
      return reset_(tab, p);
    }
    if (action === "reset_bad") {
      return reset_bad_(tab, p);
    }
    if (action === "list" || action === "rows") {
      return list_(tab, p);
    }
    if (action === "get") {
      return get_(tab, p);
    }
    return json_({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function parse_(e) {
  if (!e) return {};
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {}
  }
  return e.parameter || {};
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function norm_(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

function tz_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  } catch (e) {
    return Session.getScriptTimeZone();
  }
}

function now_() {
  return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd HH:mm:ss");
}

function fmt_(v) {
  if (v === undefined || v === null || v === "") return now_();
  var d = typeof v === "number" ? new Date(v) : new Date(String(v));
  if (isNaN(d.getTime())) return now_();
  return Utilities.formatDate(d, tz_(), "yyyy-MM-dd HH:mm:ss");
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.getRange(1, 1, 1, HEADERS.length).setBackground("#eef3ff");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(COL.created, 150);
    sheet.setColumnWidth(COL.email, 260);
    sheet.setColumnWidth(COL.qr, 150);
    sheet.setColumnWidth(COL.last, 150);
    sheet.setColumnWidth(COL.status, 110);
    sheet.setColumnWidth(COL.token, 260);
    sheet.setColumnWidth(COL.reserved, 150);
    sheet.setColumnWidth(COL.successful, 150);
    sheet.setColumnWidth(COL.rejected, 150);
    sheet.setColumnWidth(COL.notes, 220);
  }
  return sheet;
}

function findRow_(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var values = sheet.getRange(2, COL.email, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (norm_(values[i][0]) === email) return i + 2;
  }
  return -1;
}

// Upsert by email. Called only when a QR is generated.
function upsert_(tab, p) {
  var email = norm_(p.email);
  if (!email || email.indexOf("@") < 0) {
    return json_({ ok: false, error: "valid email required" });
  }

  var sheet = getSheet_(tab);
  var row = findRow_(sheet, email);
  var at = fmt_(p.at);
  var userToken = String(p.userToken || p.user_token || p.rowToken || "");
  var notes = String(p.notes || "");

  if (row < 0) {
    sheet.appendRow([
      now_(), email, at, now_(), "pending", userToken, "", "", "", notes
    ]);
    row = sheet.getLastRow();
    return json_({ ok: true, created: true, row: row, email: email, status: "pending", qrAt: at });
  }

  var status = norm_(sheet.getRange(row, COL.status).getValue());
  sheet.getRange(row, COL.qr).setValue(at);
  sheet.getRange(row, COL.last).setValue(now_());
  if (userToken) sheet.getRange(row, COL.token).setValue(userToken);
  if (notes) sheet.getRange(row, COL.notes).setValue(notes);

  // A fresh QR after a rejection makes the email available again.
  if (status === "rejected") {
    sheet.getRange(row, COL.status).setValue("pending");
    status = "pending";
  }

  return json_({ ok: true, created: false, row: row, email: email, status: status, qrAt: at });
}

function mark_(tab, p, status) {
  var email = norm_(p.email);
  if (!email) return json_({ ok: false, error: "email required" });

  var sheet = getSheet_(tab);
  var row = findRow_(sheet, email);
  var at = fmt_(p.at);

  if (row < 0) {
    sheet.appendRow([
      now_(),
      email,
      "",
      now_(),
      status,
      String(p.userToken || ""),
      status === "reserved" ? at : "",
      status === "successful" ? at : "",
      status === "rejected" ? at : "",
      String(p.notes || "")
    ]);
    return json_({ ok: true, created: true, row: sheet.getLastRow(), email: email, status: status, time: at });
  }

  sheet.getRange(row, COL.status).setValue(status);
  sheet.getRange(row, COL.last).setValue(now_());
  if (status === "reserved") sheet.getRange(row, COL.reserved).setValue(at);
  if (status === "successful") sheet.getRange(row, COL.successful).setValue(at);
  if (status === "rejected") sheet.getRange(row, COL.rejected).setValue(at);
  if (p.notes) sheet.getRange(row, COL.notes).setValue(String(p.notes));

  return json_({ ok: true, created: false, row: row, email: email, status: status, time: at });
}

// Notes-only update (used for "picked"): never changes Status.
function note_(tab, p) {
  var email = norm_(p.email);
  if (!email) return json_({ ok: false, error: "email required" });

  var sheet = getSheet_(tab);
  var row = findRow_(sheet, email);
  var note = p.notes === undefined || p.notes === null ? "" : String(p.notes);

  if (row < 0) {
    sheet.appendRow([now_(), email, "", now_(), "pending", "", "", "", "", note]);
    return json_({ ok: true, created: true, row: sheet.getLastRow(), email: email, status: "pending", notes: note });
  }

  sheet.getRange(row, COL.last).setValue(now_());
  if (p.notes !== undefined) sheet.getRange(row, COL.notes).setValue(note);
  return json_({
    ok: true,
    created: false,
    row: row,
    email: email,
    status: String(sheet.getRange(row, COL.status).getValue() || ""),
    notes: note
  });
}

// Final success: Status=completed, Successful timestamp, Token=antigravity token.
function complete_(tab, p) {
  var email = norm_(p.email);
  if (!email) return json_({ ok: false, error: "email required" });

  var sheet = getSheet_(tab);
  var row = findRow_(sheet, email);
  var at = fmt_(p.at);
  var token = String(p.antigravityToken || p.apiToken || p.rowToken || "");
  var note = p.notes === undefined || p.notes === null ? "completed" : String(p.notes);

  if (row < 0) {
    sheet.appendRow([now_(), email, "", now_(), "completed", token, "", at, "", note]);
    return json_({ ok: true, created: true, row: sheet.getLastRow(), email: email, status: "completed", successful: at });
  }

  sheet.getRange(row, COL.status).setValue("completed");
  sheet.getRange(row, COL.last).setValue(now_());
  sheet.getRange(row, COL.successful).setValue(at);
  if (token) sheet.getRange(row, COL.token).setValue(token);
  if (p.notes !== undefined) sheet.getRange(row, COL.notes).setValue(note);

  return json_({ ok: true, created: false, row: row, email: email, status: "completed", successful: at });
}

// Clear a rejection so the email can be retried. Keeps Created / QR Generated.
function reset_(tab, p) {
  var email = norm_(p.email);
  if (!email) return json_({ ok: false, error: "email required" });
  var sheet = getSheet_(tab);
  var row = findRow_(sheet, email);
  if (row < 0) return json_({ ok: false, error: "not found" });
  sheet.getRange(row, COL.status).setValue("pending");
  sheet.getRange(row, COL.successful).setValue("");
  sheet.getRange(row, COL.rejected).setValue("");
  sheet.getRange(row, COL.token).setValue("");
  sheet.getRange(row, COL.notes).setValue("");
  sheet.getRange(row, COL.last).setValue(now_());
  return json_({ ok: true, row: row, email: email, reset: true });
}

// Reset rejected rows whose Notes match any pattern (default: the bad login
// flow errors). Pass patterns:[""] to reset every rejected row.
function reset_bad_(tab, p) {
  var sheet = getSheet_(tab);
  var last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true, reset: 0 });
  var patterns = Array.isArray(p.patterns) && p.patterns.length
    ? p.patterns.map(function (x) { return String(x).toLowerCase(); })
    : ["google account recovery", "login code not received"];
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var reset = 0;
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    var email = norm_(v[COL.email - 1]);
    if (!email) continue;
    var status = norm_(v[COL.status - 1]);
    var rejected = String(v[COL.rejected - 1] || "") !== "";
    if (!rejected && status !== "rejected") continue;
    var notes = String(v[COL.notes - 1] || "").toLowerCase();
    var match = patterns.some(function (pat) { return notes.indexOf(pat) >= 0; });
    if (!match) continue;
    var r = i + 2;
    sheet.getRange(r, COL.status).setValue("pending");
    sheet.getRange(r, COL.successful).setValue("");
    sheet.getRange(r, COL.rejected).setValue("");
    sheet.getRange(r, COL.token).setValue("");
    sheet.getRange(r, COL.notes).setValue("");
    sheet.getRange(r, COL.last).setValue(now_());
    reset += 1;
  }
  return json_({ ok: true, reset: reset });
}

function rowToObj_(v) {
  return {
    created: v[COL.created - 1] instanceof Date ? fmt_(v[COL.created - 1]) : String(v[COL.created - 1] || ""),
    email: String(v[COL.email - 1] || ""),
    qrGenerated: v[COL.qr - 1] instanceof Date ? fmt_(v[COL.qr - 1]) : String(v[COL.qr - 1] || ""),
    lastOperation: v[COL.last - 1] instanceof Date ? fmt_(v[COL.last - 1]) : String(v[COL.last - 1] || ""),
    status: String(v[COL.status - 1] || ""),
    token: String(v[COL.token - 1] || ""),
    reserved: v[COL.reserved - 1] instanceof Date ? fmt_(v[COL.reserved - 1]) : String(v[COL.reserved - 1] || ""),
    successful: v[COL.successful - 1] instanceof Date ? fmt_(v[COL.successful - 1]) : String(v[COL.successful - 1] || ""),
    rejected: v[COL.rejected - 1] instanceof Date ? fmt_(v[COL.rejected - 1]) : String(v[COL.rejected - 1] || ""),
    notes: String(v[COL.notes - 1] || "")
  };
}

function list_(tab, p) {
  var sheet = getSheet_(tab);
  var last = sheet.getLastRow();
  if (last < 2) return json_({ ok: true, total: 0, rows: [] });

  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var want = norm_(p.status);
  var limit = Number(p.limit || 0);
  var rows = [];

  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (!norm_(v[COL.email - 1])) continue;
    if (want && norm_(v[COL.status - 1]) !== want) continue;
    rows.push(rowToObj_(v));
    if (limit > 0 && rows.length >= limit) break;
  }
  return json_({ ok: true, total: rows.length, rows: rows });
}

function get_(tab, p) {
  var email = norm_(p.email);
  if (!email) return json_({ ok: false, error: "email required" });

  var sheet = getSheet_(tab);
  var row = findRow_(sheet, email);
  if (row < 0) return json_({ ok: false, error: "not found" });

  var v = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  return json_({ ok: true, row: row, record: rowToObj_(v) });
}
