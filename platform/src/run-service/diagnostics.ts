/** Safe, workspace-scoped execution explanations. Raw provider credentials,
 * prompts and headers are never returned by this projection. */
export function runDiagnostics(
  events: Array<{ type: string; payload: Record<string, any> }>,
) {
  const plan = events.find((e) => e.type === "action_plan.created")?.payload;
  const failure = events.find(
    (e) => e.type === "ai_run.failed" || e.type === "ai_step.failed",
  );
  const actions = Array.isArray(plan?.actionPlan?.actions)
    ? plan!.actionPlan.actions
    : [];
  const drafts = actions
    .slice(0, 20)
    .map((a: any) => ({
      platform: String(a.platform ?? ""),
      content: String(a.content ?? "").slice(0, 20000),
      hashtags: Array.isArray(a.hashtags)
        ? a.hashtags.filter((v: unknown) => typeof v === "string")
        : [],
    }));
  if (
    plan?.actionPlan?.blockedByCompliance &&
    (!failure ||
      events.findIndex((e) => e.type === "action_plan.created") <
        events.indexOf(failure))
  ) {
    const issues = Array.isArray(plan.compliance?.issues)
      ? plan.compliance.issues
          .filter((i: any) => i.severity === "blocker")
          .map((i: any) => String(i.message).slice(0, 1000))
      : [];
    if (!issues.length)
      for (const draft of drafts) {
        const length = [draft.content, ...draft.hashtags]
          .filter(Boolean)
          .join(" ").length;
        if (draft.platform === "x" && length > 280)
          issues.push(
            `X: ${length} characters including hashtags exceeds the 280-character limit.`,
          );
      }
    return {
      failure: {
        kind: "content_blocked",
        issues: issues.length
          ? issues
          : ["Generated content did not pass publication checks."],
      },
      drafts,
    };
  }
  if (failure) {
    const message = String(failure.payload.error ?? "");
    return {
      failure: {
        kind: /无效的令牌|invalid.?token|invalid.?api.?key|unauthorized|authentication|\b401\b/i.test(
          message,
        )
          ? "provider_auth"
          : "generation_failed",
        issues: [],
      },
      drafts,
    };
  }
  return { failure: null, drafts };
}
