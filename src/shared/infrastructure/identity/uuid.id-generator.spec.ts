import { UuidIdGenerator } from './uuid.id-generator';

describe('UuidIdGenerator', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('produces a well-formed UUID v4', () => {
    expect(new UuidIdGenerator().generate()).toMatch(UUID_V4);
  });

  it('does not repeat itself across many calls', () => {
    const generator = new UuidIdGenerator();

    const ids = new Set(Array.from({ length: 1_000 }, () => generator.generate()));

    expect(ids.size).toBe(1_000);
  });
});
