/**
 * A blueprint id alone is not enough to read, bind assets onto, or render someone else's plan. The real store runs
 * on the in-memory KV; no network, no model call.
 */
import {describe, expect, it} from 'vitest';

import {assertBlueprintAccess, grantBlueprintAccess, saveBlueprint} from '../store/engineStore.ts';

describe('blueprint access', () => {
  it('the creator who made a plan can use it; another creator gets not_found (never "forbidden")', async () => {
    await grantBlueprintAccess('bp_owned_1', 'creator-a');
    await expect(assertBlueprintAccess('bp_owned_1', 'creator-a')).resolves.toBeUndefined();
    await expect(assertBlueprintAccess('bp_owned_1', 'creator-b')).rejects.toMatchObject({code: 'not_found'});
  });

  it('a cache hit grants the second creator access without taking it from the first', async () => {
    await grantBlueprintAccess('bp_shared_1', 'creator-a');
    await grantBlueprintAccess('bp_shared_1', 'creator-b');
    await expect(assertBlueprintAccess('bp_shared_1', 'creator-a')).resolves.toBeUndefined();
    await expect(assertBlueprintAccess('bp_shared_1', 'creator-b')).resolves.toBeUndefined();
    await expect(assertBlueprintAccess('bp_shared_1', 'creator-c')).rejects.toMatchObject({code: 'not_found'});
  });

  it('a plan from before this existed (no record) stays reachable, exactly as before', async () => {
    await saveBlueprint({blueprintId: 'bp_legacy_1'} as never, 'fp-legacy');
    await expect(assertBlueprintAccess('bp_legacy_1', 'anyone')).resolves.toBeUndefined();
  });

  it('ignores empty ids instead of creating a record', async () => {
    await grantBlueprintAccess('', 'creator-a');
    await grantBlueprintAccess('bp_x', '');
    await expect(assertBlueprintAccess('bp_x', 'creator-b')).resolves.toBeUndefined();
  });
});
