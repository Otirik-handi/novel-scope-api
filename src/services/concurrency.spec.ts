import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('does not exceed the configured concurrency and keeps result order', async () => {
    let active = 0;
    let maximumActive = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    expect(maximumActive).toBe(2);
    expect(result).toEqual([2, 4, 6, 8]);
  });
});
