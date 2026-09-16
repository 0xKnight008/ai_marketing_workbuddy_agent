import assert from 'node:assert/strict';
import test from 'node:test';
import { detectUrgentRisks, renderEveningRecap, renderUrgentAlert, renderWeeklyReady } from './notification-content';

test('detectUrgentRisks flags only high-severity items with verbatim citations', () => {
  const digest = {
    conflictRisks: [
      { risk: 'Raid threats in #general', severity: 'high', citations: [{ ref: 'c1', snippet: 'verbatim quote one' }] },
      { risk: 'Minor spoiler debate', severity: 'medium', citations: [{ ref: 'c2', snippet: 'not urgent' }] },
    ],
  };
  const risks = detectUrgentRisks('community_digest', digest);
  assert.equal(risks.length, 1);
  assert.equal(risks[0]?.source, 'conflict_risk');
  assert.equal(risks[0]?.severity, 'high');
  assert.equal(risks[0]?.citations[0]?.snippet, 'verbatim quote one');

  const review = {
    issueClusters: [
      { theme: 'Sizing runs small', severity: 'critical', approxCount: 12, affectedSkus: ['SKU-1'], citations: [{ ref: 'r1', snippet: 'runs at least one size small' }] },
      { theme: 'Color fade', severity: 'low', approxCount: 2, affectedSkus: [], citations: [] },
    ],
  };
  const reviewRisks = detectUrgentRisks('review_attribution', review);
  assert.equal(reviewRisks.length, 1);
  assert.equal(reviewRisks[0]?.severity, 'critical');

  assert.equal(detectUrgentRisks('daily_ops', { tasks: [] }).length, 0);
  assert.equal(detectUrgentRisks('community_digest', { conflictRisks: [] }).length, 0);
});

test('renderUrgentAlert carries severity, title and quotes without new facts', () => {
  const content = renderUrgentAlert({
    reportTitle: 'Community digest · 2026-09-17', template: 'community_digest',
    risks: [{ source: 'conflict_risk', title: 'Raid threats', severity: 'high', citations: [{ ref: 'c1', snippet: 'verbatim quote' }] }],
  });
  assert.match(content, /Urgent risk detected/);
  assert.match(content, /\[HIGH\] Raid threats/);
  assert.match(content, /“verbatim quote”/);
  assert.match(content, /acknowledge or resolve/);
});

test('renderEveningRecap summarizes decisions and unreviewed remainder', () => {
  const content = renderEveningRecap({
    date: '2026-09-17',
    completed: [{ title: 'Prepare poll', effect: 'improved' }],
    planned: 2, dismissed: 1, unreviewedTasks: 3,
  });
  assert.match(content, /Evening recap for 2026-09-17/);
  assert.match(content, /Completed today: 1/);
  assert.match(content, /Prepare poll — effect: improved/);
  assert.match(content, /Planned: 2 · Dismissed: 1/);
  assert.match(content, /3 suggestion\(s\).*unreviewed/);

  const quiet = renderEveningRecap({ date: '2026-09-17', completed: [], planned: 0, dismissed: 0, unreviewedTasks: 0 });
  assert.match(quiet, /No decisions were recorded today/);
});

test('renderWeeklyReady points to console approval without report content', () => {
  const ready = renderWeeklyReady({ title: '爆款内容复盘 · 周报 2026-09-15', template: 'content_recap' });
  assert.match(ready.subject, /\[Piggybot\] Weekly Content recap report ready for approval/);
  assert.match(ready.content, /waiting in the console under Notifications/);
  assert.match(ready.content, /approve delivery/);
});
