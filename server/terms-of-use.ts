import {
  escapeHtml,
  formatTermsDate,
  renderTermsBodyHtml,
  TERMS_SECTION_IDS,
  type TermsContent,
} from "@shared/termsContent";

export function renderTermsOfUseHtml(content: TermsContent): string {
  const nav = TERMS_SECTION_IDS.map((id) => {
    const title = escapeHtml(content.sections[id].title);
    return `<a href="#${id}">${title}</a>`;
  }).join(" · ");

  const sections = TERMS_SECTION_IDS.map((id) => {
    const section = content.sections[id];
    return `<section id="${id}">
  <h2>${escapeHtml(section.title)}</h2>
  ${renderTermsBodyHtml(section.body)}
</section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(content.pageTitle)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px 64px; line-height: 1.6; color: #111827; }
    h1, h2, h3 { line-height: 1.25; }
    h1 { margin-bottom: 0.25rem; }
    h2 { margin-top: 2.2rem; }
    h3 { margin-top: 1.4rem; }
    .muted { color: #6b7280; }
    .nav { margin: 1.25rem 0 1.75rem; }
    .nav a { color: #111827; }
    ul { padding-left: 1.4rem; }
    a { color: #111827; }
  </style>
</head>
<body>
  <h1>${escapeHtml(content.pageTitle)}</h1>
  <p class="muted">Last updated: ${escapeHtml(formatTermsDate(content.lastUpdated))}</p>
  ${renderTermsBodyHtml(content.intro)}
  <p class="muted"><a href="/privacy">Privacy Policy</a></p>
  <p class="nav muted">${nav}</p>
  ${sections}
</body>
</html>`;
}
