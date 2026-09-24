import { SystemClock } from './system.clock';

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();

    const now = new SystemClock().now();

    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
