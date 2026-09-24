/**
 * Supplies the current time.
 *
 * Reading `Date.now()` directly inside a use case makes that use case untestable
 * without patching a global, which produces tests that pass all day and fail at
 * midnight or on the last day of a month. Injecting the clock makes time an
 * ordinary input.
 */
export interface ClockPort {
  now(): Date;
}

export const CLOCK_PORT = Symbol('ClockPort');
