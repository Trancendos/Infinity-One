// Shared page shell for Portal. Design tokens live on :root so colours, radius and
// spacing can be changed in one place (light, dark, and a manual toggle).
'use strict';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
:root{--bg:#f6f7fb;--surface:#ffffff;--text:#14161f;--muted:#5b6070;--border:#d9dce6;--accent:#3b4bdb;--accent-text:#ffffff;--danger:#b42318;--focus:#f59e0b;--radius:12px;--space:16px;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1117;--surface:#181b24;--text:#eceef4;--muted:#a3a8b8;--border:#2c3040;--accent:#8b96ff;--accent-text:#0f1117;--danger:#ff8a80;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1117;--surface:#181b24;--text:#eceef4;--muted:#a3a8b8;--border:#2c3040;--accent:#8b96ff;--accent-text:#0f1117;--danger:#ff8a80;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.skip{position:absolute;left:-999px}.skip:focus{left:var(--space);top:var(--space);background:var(--surface);padding:8px;z-index:10}
header{display:flex;justify-content:space-between;align-items:center;padding:var(--space) calc(var(--space)*1.5);border-bottom:1px solid var(--border);background:var(--surface)}
header .brand{font-weight:700;letter-spacing:.02em}
main{max-width:440px;margin:48px auto;padding:0 var(--space)}
main.wide{max-width:960px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:calc(var(--space)*1.5)}
h1{font-size:1.5rem;margin:0 0 8px}
p.lead{color:var(--muted);margin:0 0 var(--space)}
label{display:block;font-weight:600;margin:var(--space) 0 4px}
input[type=email],input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
.row{display:flex;align-items:center;gap:8px;margin-top:var(--space)}
.row label{margin:0;font-weight:400}
button,.button{display:inline-block;margin-top:calc(var(--space)*1.25);padding:10px 18px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-text);font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.error{color:var(--danger);font-weight:600;margin-top:var(--space)}
ul.scopes{padding-left:20px}
.theme{background:transparent;border:1px solid var(--border);color:var(--text);margin:0;padding:6px 10px;font-weight:400}
footer{text-align:center;color:var(--muted);font-size:.85rem;margin:32px 0}
`;

const THEME_JS = `(function(){var k='inf-theme',r=document.documentElement;try{var t=localStorage.getItem(k);if(t)r.setAttribute('data-theme',t)}catch(e){}
document.addEventListener('click',function(e){var b=e.target.closest('[data-toggle-theme]');if(!b)return;var dark=r.getAttribute('data-theme')?r.getAttribute('data-theme')==='dark':matchMedia('(prefers-color-scheme: dark)').matches;var n=dark?'light':'dark';r.setAttribute('data-theme',n);b.setAttribute('aria-pressed',String(n==='dark'));try{localStorage.setItem(k,n)}catch(e){}})})();`;

function page({ title, body, wide = false, nonce }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Infinity</title>
<style nonce="${nonce}">${CSS}</style>
<script nonce="${nonce}">${THEME_JS}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header role="banner"><span class="brand">Infinity</span>
<button type="button" class="theme" data-toggle-theme aria-pressed="false" aria-label="Switch between light and dark mode">Theme</button></header>
<main id="main" class="${wide ? 'wide' : ''}" tabindex="-1">${body}</main>
<footer>Trancendos · Infinity-One</footer>
</body>
</html>`;
}

module.exports = { page, esc };
