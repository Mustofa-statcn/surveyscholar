/**
 * SurveyScholar -> Google Sheets endpoint.
 * Paste into Extensions > Apps Script of the sheet you want to fill,
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 * Copy the /exec URL into SurveyScholar > Functions > Web app URL.
 *
 * Rows are matched on Entry ID, so re-sending an entry updates its row
 * instead of adding a duplicate. Retrying a failed sync is always safe.
 * A deleted entry keeps its row and is marked in the Deleted column.
 * Section headings carry no answer and are never sent as columns.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === "ping") return out({ ok: true, message: "SurveyScholar connected" });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var name = String(d.questionnaire.title || "Responses").substring(0, 90);
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var meta = ["Entry ID", "Timestamp", "Last updated", "Interviewer", "Form version", "Deleted"];
    var labels = d.questions.map(function (q) { return q.label; });
    var header = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (!header.length) { header = meta.concat(labels); sh.getRange(1, 1, 1, header.length).setValues([header]); }
    else {
      var add = meta.concat(labels).filter(function (l) { return header.indexOf(l) === -1; });
      if (add.length) { sh.getRange(1, header.length + 1, 1, add.length).setValues([add]); header = header.concat(add); }
    }
    var row = new Array(header.length).fill("");
    function put(label, val) { var i = header.indexOf(label); if (i > -1) row[i] = val; }
    put("Entry ID", d.entry.entryId);
    put("Timestamp", d.entry.createdAt);
    put("Last updated", d.entry.updatedAt);
    put("Interviewer", d.interviewer);
    put("Form version", d.questionnaire.version);
    put("Deleted", d.entry.deleted ? "DELETED " + d.entry.deletedAt : "");
    d.questions.forEach(function (q) { put(q.label, d.entry.answers[q.id]); });
    var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    var at = -1;
    for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]) === String(d.entry.entryId)) { at = i + 2; break; } }
    if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return out({ ok: true, entryId: d.entry.entryId, updated: at > 0 });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
function doGet() { return out({ ok: true, message: "SurveyScholar endpoint is live" }); }
function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
