import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const seo = JSON.parse(await readFile(new URL('src/i18n/seo.json', root), 'utf8'));
const origin = 'https://www.piggybot.me';
const locales = ['', 'en', 'zh', 'es'];
const pages = ['', 'contact', 'privacy', 'terms', 'for/creators', 'for/sellers', 'for/community-hosts'];
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// English aliases consolidate to the root version; translated pages stay separate.
const url = (locale, page) => {
  const path = [locale === 'en' ? '' : locale, page].filter(Boolean).join('/');
  return `${origin}/${path ? `${path}/` : ''}`;
};
const canonicalUrls = new Set();

for (const locale of locales) {
  for (const page of pages) {
    if (locale === 'en' && page.startsWith('for/')) continue;
    const file = new URL([...([locale, page].filter(Boolean)), 'index.html'].join('/'), root);
    let html = await readFile(file, 'utf8');
    const lang = locale || 'en';
    const title = page ? html.match(/<title>(.*?)<\/title>/s)?.[1] : escape(seo[lang].title);
    const description = page ? html.match(/<meta name="description" content="([^"]*)"\s*\/>/)?.[1] : escape(seo[lang].description);
    if (!title || !description) throw new Error(`Missing metadata: ${fileURLToPath(file)}`);
    const canonical = url(locale, page);
    canonicalUrls.add(canonical);
    html = html.replace(/\s*<!-- SEO:start -->[\s\S]*?<!-- SEO:end -->/g, '')
      .replace(/\s*<title>.*?<\/title>/gs, '')
      .replace(/\s*<meta (?:name="description"|property="og:[^"]+")[^>]*>/g, '');
    const tags = [
      '<!-- SEO:start -->',
      `<title>${title}</title>`,
      `<meta name="description" content="${description}" />`,
      `<link rel="canonical" href="${canonical}" />`,
      ...['en', 'zh', 'es', 'x-default'].map((alternate) => `<link rel="alternate" hreflang="${alternate}" href="${url(alternate === 'x-default' ? 'en' : alternate, page)}" />`),
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="Piggybot" />',
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
      `<meta property="og:url" content="${canonical}" />`,
      '<meta name="twitter:card" content="summary" />',
      `<meta name="twitter:title" content="${title}" />`,
      `<meta name="twitter:description" content="${description}" />`,
    ];
    if (!page) {
      tags.push(`<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'SoftwareApplication',
        name: 'Piggybot', url: canonical, applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web', inLanguage: lang, description: seo[lang].description,
      }).replaceAll('<', '\\u003c')}</script>`);
    }
    tags.push('<!-- SEO:end -->');
    html = html.replace('</head>', `  ${tags.join('\n    ')}\n  </head>`);
    await writeFile(file, html);
  }
}

await writeFile(new URL('public/sitemap.xml', root), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...canonicalUrls].map((location) => `  <url><loc>${location}</loc></url>`).join('\n')}\n</urlset>\n`);
await writeFile(new URL('public/robots.txt', root), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`Generated SEO metadata and ${canonicalUrls.size} canonical sitemap URLs.`);
