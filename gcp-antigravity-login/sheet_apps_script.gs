// Paste this into the Apps Script editor bound to your Google Sheet.
// Deploy as Web App: Execute as Me, Who has access: Anyone.
// Update the existing deployment to a new version so the URL stays the same.
// Columns: A Time | B Email | C Code | D Result | E Login Status

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let best = null;
  let bestRows = 0;
  ss.getSheets().forEach(function (sh) {
    const n = sh.getLastRow();
    if (n > bestRows) {
      bestRows = n;
      best = sh;
    }
  });
  const target = best || ss.getSheets()[0];
  if (target.getLastRow() === 0) {
    target.appendRow(["Time", "Email", "Code", "Result", "Login Status"]);
  } else if (!target.getRange(1, 5).getValue()) {
    target.getRange(1, 5).setValue("Login Status");
  }
  return target;
}

function rows_() {
  const sh = sheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1).map(function (r) {
    return {
      time: r[0],
      email: String(r[1] || ""),
      code: String(r[2] || ""),
      result: String(r[3] || ""),
      status: String(r[4] || "")
    };
  }).filter(function (r) { return r.email; });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function claim_(email) {
  const target = String(email || "").trim();
  if (!target) return { ok: false, error: "email" };

  const sh = sheet_();
  const mine = rows_().filter(function (r) {
    return r.email.toLowerCase() === target.toLowerCase();
  });
  const statuses = mine.map(function (r) {
    return (r.result + " " + r.status).toLowerCase();
  });
  const all = statuses.join(" | ");

  if (/(accepted|complete|completed)/.test(all)) {
    return { ok: true, claimed: false, reason: "finished" };
  }

  const now = Date.now();
  const hasRejected = /rejected/.test(all);
  const recentRejected = mine.some(function (r) {
    const value = (r.result + " " + r.status).toLowerCase();
    if (value.indexOf("rejected") < 0) return false;
    return now - new Date(r.time).getTime() < 5 * 60 * 1000;
  });
  if (recentRejected) {
    return { ok: true, claimed: false, reason: "rejected_wait" };
  }

  // If it was rejected before, allow a retry after 5 minutes even though a
  // previous picked marker exists.
  if (!hasRejected) {
    const recentPick = mine.some(function (r) {
      const value = (r.result + " " + r.status).toLowerCase();
      if (value.indexOf("picked") < 0) return false;
      return now - new Date(r.time).getTime() < 15 * 60 * 1000;
    });
    if (recentPick) return { ok: true, claimed: false, reason: "picked" };
  }

  const signupTimes = mine
    .filter(function (r) { return r.result.toLowerCase() === "sign up completed"; })
    .map(function (r) { return new Date(r.time).getTime(); })
    .filter(function (t) { return t > 0; });

  if (!signupTimes.length) {
    return { ok: true, claimed: false, reason: "not_signup_completed" };
  }

  // Don't steal an account the creator extension may still be finishing.
  const latestSignup = Math.max.apply(null, signupTimes);
  if (now - latestSignup < 15 * 60 * 1000) {
    return { ok: true, claimed: false, reason: "recent_signup" };
  }

  // Claim is recorded in E (Login Status); D stays untouched.
  sh.appendRow([new Date(), target, "CLAIM-" + now, "", "picked"]);
  return { ok: true, claimed: true };
}

function doGet(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const action = String((e.parameter.action || "")).toLowerCase();
    if (action === "list") return json_({ ok: true, rows: rows_() });
    if (action === "claim") return json_(claim_(e.parameter.email));
    return json_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let d = {};
    try {
      d = JSON.parse((e.postData && e.postData.contents) || "{}");
    } catch (err) {}

    if (d.action === "list") return json_({ ok: true, rows: rows_() });
    if (d.action === "claim") return json_(claim_(d.email));

    const sh = sheet_();
    const code = String(d.code || "");
    const row = [
      new Date(d.time || Date.now()),
      d.email || "",
      code,
      d.result || "",
      d.status || ""
    ];

    if (code) {
      const values = sh.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][2]) === code) {
          sh.getRange(i + 1, 1, 1, 5).setValues([row]);
          return json_({ ok: true, updated: true });
        }
      }
    }

    sh.appendRow(row);
    return json_({ ok: true, appended: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
