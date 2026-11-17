const stateOrder = ["assigned", "in-review", "submitted"];

export type SlideReview = { task_code: string; user_id: string; state: string };

export type ReviewerSummary = { user_id: string; state: string; tasks: number };

export function reviewersOf(reviews: readonly SlideReview[]): ReviewerSummary[] {
  const byPerson = new Map<string, ReviewerSummary>();
  for (const review of reviews) {
    const found = byPerson.get(review.user_id);
    if (found === undefined) {
      byPerson.set(review.user_id, { user_id: review.user_id, state: review.state, tasks: 1 });
      continue;
    }
    found.tasks += 1;
    if (stateOrder.indexOf(review.state) > stateOrder.indexOf(found.state)) {
      found.state = review.state;
    }
  }
  return [...byPerson.values()];
}
