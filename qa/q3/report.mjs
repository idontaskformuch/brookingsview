// QA Q3 -- HTML report: per town, per page type: phone screenshot in light + dark, findings with suggested cause.
// Screenshots are referenced relatively (screenshots/<label>-<mode>-fold.jpg) so the report can be opened locally
// or published together with the screenshots folder.
import { writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { CHECKLIST } from './review.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEV = { high: 0, medium: 1, low: 2 };
const checkLabel = (id) => CHECKLIST.find((c) => c.id === id)?.label ?? `check ${id}`;

export function renderReport({ summary, pages }) {
  const towns = [...new Set(pages.map((p) => p.town))];
  const all = pages.flatMap((p) => p.findings.map((x) => ({ ...x, town: p.town, path: p.path })));
  const byCheck = CHECKLIST.map((c) => ({ ...c, n: all.filter((x) => x.check === c.id).length }));
  const counts = (t) => {
    const fs = all.filter((x) => x.town === t);
    return `${fs.filter((x) => x.severity === 'high').length} high, ${fs.filter((x) => x.severity === 'medium').length} medium, ${fs.filter((x) => x.severity === 'low').length} low`;
  };
  const card = (p) => {
    const fs = [...p.findings].sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.check - b.check);
    const img = (mode) => (p[mode]?.shots?.fold ? `<figure><img loading="lazy" src="screenshots/${esc(basename(p[mode].shots.fold))}" alt="${esc(p.path)} (${mode} mode, phone)"><figcaption>${mode}</figcaption></figure>` : '<figure><figcaption>no screenshot</figcaption></figure>');
    const rows = fs.length
      ? `<table><thead><tr><th>Sev</th><th>Check</th><th>Finding</th><th>Suggested cause</th><th>By</th></tr></thead><tbody>${fs.map((x) =>
        `<tr class="sev-${esc(x.severity)}"><td>${esc(x.severity)}</td><td>${x.check}. ${esc(checkLabel(x.check))}</td><td>${esc(x.evidence)}${x.where && x.where !== p.path ? `<br><small>${esc(x.where)}</small>` : ''}</td><td>${esc(x.cause)}</td><td>${x.source === 'ai' ? 'AI' : 'rule'}</td></tr>`).join('')}</tbody></table>`
      : '<p class="ok">No findings.</p>';
    const pair = p.pair ? `<p class="pair"><b>List + detail pair</b> (${esc(p.pair.list)} / ${esc(p.pair.detail)}): detail page adds <b>${esc(p.pair.adds ?? '?')}</b>. ${esc(p.pair.summary)}${p.pair.listShould ? ` <i>List should: ${esc(p.pair.listShould)}</i>` : ''}</p>` : '';
    return `<section class="card"><h3><a href="${esc(p.url)}" rel="noopener">${esc(p.path)}</a> <small>${esc(p.kind)} · HTTP ${esc(p.status ?? '?')}${p.reviewError ? ' · AI review failed' : ''}${p.reviewSkipped ? ' · AI review skipped' : ''}</small></h3><div class="shots">${img('light')}${img('dark')}</div>${pair}${rows}</section>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QA Q3 review ${esc(summary.date)}</title>
<style>
:root{--bg:#fbfaf7;--ink:#161614;--soft:#55554f;--rule:#d9d6cc;--card:#fff;--hi:#fee2e2;--med:#fdf1cf;--lo:#eef2f7}
@media (prefers-color-scheme:dark){:root{--bg:#121210;--ink:#ece9e1;--soft:#b8b5ab;--rule:#3a3935;--card:#1c1c19;--hi:#3b1616;--med:#33260a;--lo:#1b2a3d}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:16px}
h1{margin:.2em 0}h2{margin-top:2.2em;border-bottom:1px solid var(--rule);padding-bottom:.2em}small{color:var(--soft);font-weight:400}
.card{background:var(--card);border:1px solid var(--rule);padding:12px 14px;margin:14px 0}.shots{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}
figure{margin:0}figure img{width:195px;border:1px solid var(--rule);display:block}figcaption{font-size:12px;color:var(--soft)}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-top:1px solid var(--rule);padding:6px 8px;text-align:left;vertical-align:top}
.sev-high td:first-child{background:var(--hi)}.sev-medium td:first-child{background:var(--med)}.sev-low td:first-child{background:var(--lo)}.ok{color:var(--soft)}.pair{background:var(--lo);padding:6px 10px;margin:6px 0}
.sum td,.sum th{padding:4px 10px}@media (max-width:640px){table,thead,tbody,tr,th,td{display:block}thead{display:none}td{border:0}tr{border-top:1px solid var(--rule);padding:6px 0}}
</style></head><body><main>
<h1>QA Q3 review · ${esc(summary.date)}</h1>
<p>${pages.length} page types across ${towns.length} towns, phone viewport, light and dark. ${summary.model ? `AI reviewer: ${esc(summary.model)}, ${summary.tokens.input} in / ${summary.tokens.output} out tokens, about $${summary.estimatedUsd} (${esc(summary.priceAssumption)}).` : 'AI review off (rule checks only).'}
Findings marked <b>rule</b> come from deterministic checks, <b>AI</b> from the reviewer; every finding names a suggested cause and none has been fixed.</p>
<h2>Summary</h2>
<table class="sum"><thead><tr><th>Town</th><th>Findings</th></tr></thead><tbody>${towns.map((t) => `<tr><td>${esc(t)}</td><td>${counts(t)}</td></tr>`).join('')}</tbody></table>
<table class="sum"><thead><tr><th>Checklist item</th><th>Findings</th></tr></thead><tbody>${byCheck.map((c) => `<tr><td>${c.id}. ${esc(c.label)}</td><td>${c.n}</td></tr>`).join('')}</tbody></table>
${towns.map((t) => `<h2>${esc(t)} <small>${counts(t)}</small></h2>${pages.filter((p) => p.town === t).map(card).join('')}`).join('')}
</main></body></html>`;
}

export function writeReport(outDir, data) {
  writeFileSync(resolve(outDir, 'report.html'), renderReport(data));
}
