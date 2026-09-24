/**
 * Supplies unique identifiers.
 *
 * Injected for the same reason as the clock: a use case that calls
 * `crypto.randomUUID()` itself cannot be asserted against a known identifier,
 * so its tests end up asserting that "something" was saved rather than what.
 */
export interface IdGeneratorPort {
  generate(): string;
}

export const ID_GENERATOR_PORT = Symbol('IdGeneratorPort');
