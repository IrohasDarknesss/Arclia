export interface UserInterestItem {
  topic: string;
  weight: number;
}

export interface RecommendationCandidateRow {
  paperId: number;
  arxivId: string;
  title: string;
  abstract: string;
  authors: Array<{ name: string; affiliation: string | null }>;
  categories: string[];
  submittedAt: string;
  updatedAt: string | null;
  latestVersion: number;
  titleJa: string | null;
  thesisText: string | null;
  sourceScope: "abstract_only" | "full_text" | null;
  summaryGeneratedAt: string | null;
}

export interface ScoredRecommendationItem {
  arxivId: string;
  title: string;
  titleJa: string | null;
  authors: Array<{ name: string; affiliation: string | null }>;
  categories: string[];
  submittedAt: string;
  updatedAt: string | null;
  latestVersion: number;
  shortSummary: {
    thesis: string;
    sourceScope: "abstract_only" | "full_text";
    generatedAt: string;
  } | null;
  matchScore: number;
  matchedTopics: string[];
}

export function scoreAndSelectRecommendations(
  interests: UserInterestItem[],
  candidates: RecommendationCandidateRow[],
  limit: number,
  now = new Date(),
): ScoredRecommendationItem[] {
  const scored: Array<{
    item: ScoredRecommendationItem;
    submittedMs: number;
    paperId: number;
  }> = [];

  for (const cand of candidates) {
    const matchedTopics: string[] = [];
    let topicScore = 0;

    const primaryCat = cand.categories[0] || "";
    const secondaryCats = cand.categories.slice(1);
    const textLower = `${cand.title} ${cand.abstract}`.toLowerCase();

    for (const interest of interests) {
      const topic = interest.topic.trim();
      const weight = Number(interest.weight) || 1.0;

      if (topic === primaryCat) {
        topicScore += weight * 1.0;
        matchedTopics.push(topic);
      } else if (secondaryCats.includes(topic)) {
        topicScore += weight * 0.6;
        matchedTopics.push(topic);
      } else if (topic.length > 0 && textLower.includes(topic.toLowerCase())) {
        topicScore += weight * 0.4;
        matchedTopics.push(topic);
      }
    }

    if (matchedTopics.length === 0) {
      continue;
    }

    const submittedMs = new Date(cand.submittedAt).getTime();
    const ageDays = Math.max(
      0,
      (now.getTime() - submittedMs) / (1000 * 60 * 60 * 24),
    );
    const freshnessBonus = 0.2 * Math.max(0, 1 - ageDays / 30);
    const matchScore = Math.round((topicScore + freshnessBonus) * 100) / 100;

    scored.push({
      paperId: cand.paperId,
      submittedMs,
      item: {
        arxivId: cand.arxivId,
        title: cand.title,
        titleJa: cand.titleJa,
        authors: cand.authors,
        categories: cand.categories,
        submittedAt: cand.submittedAt,
        updatedAt: cand.updatedAt,
        latestVersion: cand.latestVersion,
        shortSummary:
          cand.thesisText && cand.sourceScope && cand.summaryGeneratedAt
            ? {
                thesis: cand.thesisText,
                sourceScope: cand.sourceScope,
                generatedAt: cand.summaryGeneratedAt,
              }
            : null,
        matchScore,
        matchedTopics,
      },
    });
  }

  scored.sort((a, b) => {
    if (b.item.matchScore !== a.item.matchScore) {
      return b.item.matchScore - a.item.matchScore;
    }
    if (b.submittedMs !== a.submittedMs) {
      return b.submittedMs - a.submittedMs;
    }
    return b.paperId - a.paperId;
  });

  return scored.slice(0, limit).map((s) => s.item);
}
