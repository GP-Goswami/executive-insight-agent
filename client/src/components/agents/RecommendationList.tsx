// A09 — RecommendationList (standalone). Renders this week's recommendations as
// numbered priority cards (sorted by priority). Renders nothing when empty.
// Self-contained; not yet wired into report-preview.tsx.

import { RecommendationCard, type Recommendation } from "./RecommendationCard";

export type { Recommendation } from "./RecommendationCard";

interface RecommendationListProps {
  recommendations: Recommendation[];
  /** Optional heading shown above the cards. */
  title?: string;
}

export function RecommendationList({ recommendations, title = "This Week's Actions" }: RecommendationListProps) {
  if (!recommendations || recommendations.length === 0) return null;

  const sorted = [...recommendations].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  return (
    <section data-testid="recommendation-list">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      <div className="grid grid-cols-1 gap-3">
        {sorted.map((rec) => (
          <RecommendationCard key={rec.id} recommendation={rec} />
        ))}
      </div>
    </section>
  );
}
