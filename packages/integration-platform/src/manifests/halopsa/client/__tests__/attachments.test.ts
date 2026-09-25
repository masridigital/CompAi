import { beforeEach, describe, expect, it } from 'bun:test';
import {
  base64DecodedBytes,
  createHaloClient,
  HALO_MAX_ATTACHMENT_BYTES,
  HaloAttachmentTooLargeError,
  resetHaloTokenCache,
} from '../index';
import { createMockFetch, jsonResponse, noSleep, TEST_CONFIG } from './test-utils';

beforeEach(() => resetHaloTokenCache());

describe('base64DecodedBytes', () => {
  it('computes the decoded size including padding', () => {
    expect(base64DecodedBytes(Buffer.from('hello').toString('base64'))).toBe(5);
    expect(base64DecodedBytes(Buffer.from('hi').toString('base64'))).toBe(2);
    expect(base64DecodedBytes(Buffer.from('abc').toString('base64'))).toBe(3);
  });
});

describe('attachToTicket', () => {
  it('POSTs an array body to /Attachment and returns the id', async () => {
    const mock = createMockFetch(() => jsonResponse({ id: 77 }));
    const halo = createHaloClient({ config: TEST_CONFIG, fetchImpl: mock.fetch, sleep: noSleep });

    const id = await halo.attachToTicket({ ticketId: 12, filename: 'report.pdf', base64: 'JVBERg==' });

    expect(id).toBe(77);
    const [call] = mock.apiCalls();
    expect(new URL(call.url).pathname).toBe('/api/Attachment');
    expect(call.method).toBe('POST');
    expect(JSON.parse(call.body ?? '')).toEqual([
      { ticket_id: 12, filename: 'report.pdf', data_base64: 'JVBERg==' },
    ]);
  });

  it('refuses files over 10 MB without calling Halo', async () => {
    const mock = createMockFetch(() => jsonResponse({ id: 1 }));
    const halo = createHaloClient({ config: TEST_CONFIG, fetchImpl: mock.fetch, sleep: noSleep });
    const tooBig = 'A'.repeat(Math.ceil(((HALO_MAX_ATTACHMENT_BYTES + 1) * 4) / 3) + 4);

    await expect(halo.attachToTicket({ ticketId: 1, filename: 'x.pdf', base64: tooBig })).rejects.toBeInstanceOf(
      HaloAttachmentTooLargeError,
    );
    expect(mock.apiCalls()).toHaveLength(0);
  });
});
