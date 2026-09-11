import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT } from '../src/i18n/content';

for (const [locale, content] of Object.entries(CONTENT)) {
  test(`${locale}: feature sections are nested, while pricing and account access remain available`, () => {
    assert.deepEqual(content.nav.links.map((link) => link.href), ['#features', '#pricing']);
    assert.deepEqual(content.nav.featureLinks.map((link) => link.href), ['#audiences', '#copilot', '#workflows', '#modes', '#governance', '#integrations']);
    assert.ok(content.nav.featuresOverview && content.nav.menu && content.nav.console);
    assert.ok(content.nav.featureLinks.every((link) => link.label));
  });
  test(`${locale}: removed footer columns are absent but subscription and legal copy remain`, () => {
    assert.equal('columns' in content.footer, false);
    assert.ok(content.footer.signupButton && content.footer.legal.privacy && content.footer.legal.terms && content.footer.copyright);
  });
}
