/** Same whitelist on server and UI. Text always comes from a saved report. */
export function reportDrafts(template: string, report: Record<string, unknown>) {
  const fields: Record<string, Array<[string, string | null]>> = {
    content_recap: [['draftTitles', null], ['draftScripts', 'body']],
    comment_insights: [['highValueComments', 'replyDraft']],
    product_opportunities: [['presalePollDraft', null], ['opportunities', 'listingDraft']],
    review_attribution: [['serviceReplyDrafts', 'replyDraft']],
    community_digest: [['announcementDraft', null]],
    daily_ops: [['tasks', 'draftCopy']],
  };
  return (fields[template] ?? []).flatMap(([field, member]) => {
    const value = report[field];
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry, index) => {
      const text = member && entry && typeof entry === 'object' ? entry[member] : entry;
      if (typeof text !== 'string' || !text.trim()) return [];
      return [{ key: Array.isArray(value) ? `${field}:${index}` : field, label: `${field} ${Array.isArray(value) ? index + 1 : ''}`.trim(), text }];
    });
  });
}
