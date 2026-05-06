import { searchAllRecords } from './repository';
import type { UnifiedSearchQueryInput } from './schema';

export async function searchAll(input: UnifiedSearchQueryInput) {
  return searchAllRecords(input);
}

