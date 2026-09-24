import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { IdGeneratorPort } from '../../domain/id-generator.port';

/**
 * Uses the platform's UUID v4. No dependency is needed: `node:crypto` has been
 * providing a cryptographically strong implementation since Node 14.
 */
@Injectable()
export class UuidIdGenerator implements IdGeneratorPort {
  generate(): string {
    return randomUUID();
  }
}
