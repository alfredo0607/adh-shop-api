import { DomainHttpException } from '../http/domain-http.exception';
import {
  type IdempotencyBegin,
  IdempotencyKeyReused,
  type IdempotencyStore,
  IdempotentRequestInProgress,
} from './idempotency.store';

interface Entry {
  fingerprint: string;
  completed?: { statusCode: number; body: unknown };
}

/** Same rules as the DynamoDB store, held in a map. For tests. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly entries = new Map<string, Entry>();

  begin(key: string, fingerprint: string): Promise<IdempotencyBegin> {
    const existing = this.entries.get(key);

    if (existing === undefined) {
      this.entries.set(key, { fingerprint });
      return Promise.resolve({ outcome: 'STARTED' });
    }

    if (existing.fingerprint !== fingerprint) {
      return Promise.reject(new DomainHttpException(new IdempotencyKeyReused()));
    }

    if (existing.completed === undefined) {
      return Promise.reject(new DomainHttpException(new IdempotentRequestInProgress()));
    }

    return Promise.resolve({ outcome: 'REPLAY', ...existing.completed });
  }

  complete(key: string, fingerprint: string, statusCode: number, body: unknown): Promise<void> {
    this.entries.set(key, { fingerprint, completed: { statusCode, body } });
    return Promise.resolve();
  }

  abandon(key: string): Promise<void> {
    if (this.entries.get(key)?.completed === undefined) {
      this.entries.delete(key);
    }
    return Promise.resolve();
  }
}
