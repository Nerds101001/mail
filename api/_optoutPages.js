// api/_optoutPages.js — the small HTML pages a RECIPIENT sees after clicking Interested / Not Interested
// (or an old footer "Unsubscribe" link). Shared module, not a route.
//
// WHY A CONFIRMATION STEP: those links used to act the moment they were opened. Mail-security
// scanners (corporate gateways, link checkers) open every link in a message, so they "clicked"
// Interested AND Not Interested within ~0.13 s of each other — pushing leads to DEMO and then opting
// them out for good with no human involved. Now opening the link only shows a page with a button;
// the change is made by the button's POST, which scanners do not send.

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;}
  .card{background:#fff;border-radius:12px;padding:44px 36px;max-width:440px;width:92%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
  .icon{font-size:48px;margin-bottom:16px;}
  h2{color:#111827;font-size:22px;margin-bottom:10px;}
  p{color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:6px;}
  form{margin-top:22px;}
  button{cursor:pointer;border:0;border-radius:8px;padding:12px 26px;font-size:15px;font-weight:700;color:#fff;}
  .small{font-size:12px;color:#9ca3af;margin-top:16px;}`;

function shell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
  <div class="card">
${bodyHtml}
  </div>
</body>
</html>`;
}

// Page shown when the link is OPENED. No side effects: the button POSTs to `postTo`.
function confirmPage({ title, icon, heading, text, button, color, postTo }) {
  return shell(title, `    <div class="icon">${icon}</div>
    <h2>${esc(heading)}</h2>
    <p>${esc(text)}</p>
    <form method="POST" action="${esc(postTo)}">
      <button type="submit" style="background:${esc(color)}">${esc(button)}</button>
    </form>
    <p class="small">Nothing changes until you press the button.</p>`);
}

// Page shown after the button was pressed and the change was made.
function donePage({ title, icon, heading, text }) {
  return shell(title, `    <div class="icon">${icon}</div>
    <h2>${esc(heading)}</h2>
    <p>${esc(text)}</p>`);
}

function errorPage(text) {
  return shell("Something went wrong", `    <div class="icon">⚠️</div>
    <h2>We couldn't complete that</h2>
    <p>${esc(text || "Please try again in a moment, or reply to the email and we will sort it out.")}</p>`);
}

module.exports = { confirmPage, donePage, errorPage, esc };
