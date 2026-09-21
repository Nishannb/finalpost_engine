import {afterEach, describe, expect, it, vi} from 'vitest';

import {EngineError} from './errors.ts';
import {requestWithRetry} from './http.ts';

describe('requestWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not retry an aborted request', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      requestWithRetry('https://example.com/generate', {
        label: 'Director v2 creative director',
        timeoutMs: 20,
        retries: 1,
      }),
    ).rejects.toMatchObject({
      code: 'upstream_timeout',
    } satisfies Partial<EngineError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
