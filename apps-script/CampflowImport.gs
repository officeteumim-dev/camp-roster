/**
 * Camp Flow → roster app: picks up Camp Flow's scheduled report emails and sends each report's download link to the
 * roster app, which downloads and imports it. Runs every hour from the office Gmail account; nothing to leave running.
 *
 * Setup (once, signed in as the Gmail account that receives the Camp Flow reports):
 * 1. Go to script.google.com → New project → name it "Camp Flow import". Paste this whole file in, replacing what's there.
 * 2. Project Settings (gear) → Script properties → add:
 *      IMPORT_URL  = https://<your-project>.supabase.co/functions/v1/import-campflow?camp=teumim
 *      IMPORT_KEY  = (the import key from SETUP-STATUS / Supabase secrets)
 *      ALERT_EMAIL = office.teumim@gmail.com   (who hears about failures)
 * 3. Run "setup" once from the toolbar and approve the permissions it asks for.
 * After that, "checkReports" runs every hour. Processed emails get the Gmail label "Camp Flow/imported".
 */

const SEARCH = 'from:info@campflow.org "Scheduled report" newer_than:7d -label:camp-flow-imported';
const LABEL_DONE = 'Camp Flow/imported';
const LABEL_FAILED = 'Camp Flow/import failed';

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkReports').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('checkStale').timeBased().everyDays(1).atHour(11).create();
  GmailApp.createLabel(LABEL_DONE); GmailApp.createLabel(LABEL_FAILED);
  checkReports();
}

function props_() {
  const p = PropertiesService.getScriptProperties();
  const cfg = { url: p.getProperty('IMPORT_URL'), key: p.getProperty('IMPORT_KEY'), alert: p.getProperty('ALERT_EMAIL') || Session.getActiveUser().getEmail() };
  if (!cfg.url || !cfg.key) throw new Error('Set IMPORT_URL and IMPORT_KEY in Project Settings → Script properties.');
  return cfg;
}

// The "Download Excel File" link in a Camp Flow report email.
function reportLink_(html) {
  const m = html.match(/href="(https:\/\/[^"]+\.xlsx\?[^"]+)"/i) || html.match(/href="(https:\/\/[^"]*digitaloceanspaces\.com[^"]+)"/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

function checkReports() {
  const cfg = props_();
  const done = GmailApp.getUserLabelByName(LABEL_DONE) || GmailApp.createLabel(LABEL_DONE);
  const failed = GmailApp.getUserLabelByName(LABEL_FAILED) || GmailApp.createLabel(LABEL_FAILED);
  const threads = GmailApp.search(SEARCH, 0, 20);
  const store = PropertiesService.getScriptProperties();
  const doneIds = JSON.parse(store.getProperty('DONE_IDS') || '[]');
  threads.reverse().forEach(thread => {
    let ok = true;
    // Gmail groups the daily copies of a report into one thread: only the newest copy matters (older links expire).
    [thread.getMessages().pop()].forEach(msg => {
      if (doneIds.indexOf(msg.getId()) >= 0) return;
      const link = reportLink_(msg.getBody());
      if (!link) return;
      const res = UrlFetchApp.fetch(cfg.url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-import-key': cfg.key }, payload: JSON.stringify({ url: link })
      });
      const code = res.getResponseCode(), body = res.getContentText();
      if (code >= 200 && code < 300) {
        store.setProperty('LAST_SUCCESS', new Date().toISOString());
        doneIds.push(msg.getId());
        store.setProperty('DONE_IDS', JSON.stringify(doneIds.slice(-300)));
        const r = JSON.parse(body);
        if (r.problems && r.problems.length) {
          MailApp.sendEmail(cfg.alert, 'Camp Flow import: please check ' + r.problems.length + ' item(s)',
            'The ' + r.report + ' report was imported (' + JSON.stringify(r.counts) + '), with these notes:\n\n' +
            r.problems.slice(0, 30).map(p => '- ' + (p.row ? 'Row ' + p.row + ': ' : '') + (p.camper ? p.camper + ': ' : '') + p.problem).join('\n'));
        }
      } else {
        ok = false;
        MailApp.sendEmail(cfg.alert, 'Camp Flow import failed', 'The roster app could not import "' + msg.getSubject() + '" (' + code + '):\n\n' + body.slice(0, 1000) + '\n\nIt will be retried in an hour while the link is valid. You can also upload the file in the roster app under Imports.');
      }
    });
    if (ok) { thread.removeLabel(failed); thread.addLabel(done); } else thread.addLabel(failed);
  });
}

// One email a day if no report has been imported for 2 days.
function checkStale() {
  const cfg = props_();
  const last = PropertiesService.getScriptProperties().getProperty('LAST_SUCCESS');
  if (!last || Date.now() - new Date(last).getTime() > 2 * 864e5) {
    MailApp.sendEmail(cfg.alert, 'No Camp Flow report imported in 2 days', 'The roster app has not received a Camp Flow report since ' + (last || 'setup') + '. Check that the scheduled reports in Camp Flow are still set to send daily to this Gmail account.');
  }
}
