export interface CoverCandidate {
  routeId: string;
  targetIds: string[];
}

export interface GreedyCoverResult {
  selectedRouteIds: string[];
  unmappedTargetIds: string[];
}

export function greedyCover(candidates: CoverCandidate[], allTargetIds: string[]): GreedyCoverResult {
  const uncovered = new Set(allTargetIds);
  const selectedRouteIds: string[] = [];
  const remainingCandidates = [...candidates].sort((a, b) => a.routeId.localeCompare(b.routeId));

  while (uncovered.size > 0) {
    let bestCandidate: CoverCandidate | null = null;
    let bestCoverage = 0;

    for (const candidate of remainingCandidates) {
      const coverage = countUncovered(candidate.targetIds, uncovered);
      if (
        coverage > bestCoverage ||
        (coverage === bestCoverage && coverage > 0 && bestCandidate && candidate.routeId < bestCandidate.routeId)
      ) {
        bestCandidate = candidate;
        bestCoverage = coverage;
      }
    }

    if (!bestCandidate || bestCoverage === 0) {
      break;
    }

    selectedRouteIds.push(bestCandidate.routeId);
    for (const targetId of bestCandidate.targetIds) {
      uncovered.delete(targetId);
    }

    const selectedIndex = remainingCandidates.findIndex((candidate) => candidate.routeId === bestCandidate?.routeId);
    if (selectedIndex >= 0) {
      remainingCandidates.splice(selectedIndex, 1);
    }
  }

  return {
    selectedRouteIds,
    unmappedTargetIds: Array.from(uncovered).sort(),
  };
}

function countUncovered(targetIds: string[], uncovered: Set<string>): number {
  let count = 0;
  for (const targetId of new Set(targetIds)) {
    if (uncovered.has(targetId)) {
      count += 1;
    }
  }
  return count;
}
