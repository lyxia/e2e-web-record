import { greedyCover } from '../src/greedyCover';

describe('greedyCover', () => {
  it('selects routes that greedily cover all reachable targets', () => {
    const result = greedyCover(
      [
        { routeId: 'a', targetIds: ['t1', 't2'] },
        { routeId: 'b', targetIds: ['t2', 't3'] },
        { routeId: 'c', targetIds: ['t4'] },
      ],
      ['t1', 't2', 't3', 't4'],
    );

    expect(result).toEqual({
      selectedRouteIds: ['a', 'b', 'c'],
      unmappedTargetIds: [],
    });
  });

  it('reports targets that no route reaches', () => {
    const result = greedyCover([{ routeId: 'a', targetIds: ['t1'] }], ['t1', 't2']);

    expect(result).toEqual({
      selectedRouteIds: ['a'],
      unmappedTargetIds: ['t2'],
    });
  });

  it('uses route id as deterministic tie breaker', () => {
    const result = greedyCover(
      [
        { routeId: 'b', targetIds: ['t1'] },
        { routeId: 'a', targetIds: ['t1'] },
      ],
      ['t1'],
    );

    expect(result.selectedRouteIds).toEqual(['a']);
  });
});
