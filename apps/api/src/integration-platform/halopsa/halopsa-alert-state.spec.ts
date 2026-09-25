import { decideAlertAction, type LinkSnapshot } from './halopsa-alert-state';

const now = new Date('2026-09-25T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const link = (overrides: Partial<LinkSnapshot>): LinkSnapshot => ({
  state: 'open',
  haloTicketId: 101,
  resolvedAt: null,
  ...overrides,
});

describe('decideAlertAction', () => {
  describe('failing', () => {
    it('creates a ticket when there is no link', () => {
      expect(decideAlertAction({ link: null, failing: true, hasQueuedEvent: false, now })).toBe('create');
    });

    it('adds a note on repeat failure while the ticket is open', () => {
      expect(decideAlertAction({ link: link({}), failing: true, hasQueuedEvent: false, now })).toBe('note');
    });

    it('does nothing while the create is still queued', () => {
      const pending = link({ state: 'pending_create', haloTicketId: null });
      expect(decideAlertAction({ link: pending, failing: true, hasQueuedEvent: true, now })).toBe('none');
    });

    it('re-creates when a pending_create link has nothing queued (dead create)', () => {
      const pending = link({ state: 'pending_create', haloTicketId: null });
      expect(decideAlertAction({ link: pending, failing: true, hasQueuedEvent: false, now })).toBe('create');
    });

    it('reopens a ticket resolved within 7 days', () => {
      const resolved = link({ state: 'resolved', resolvedAt: daysAgo(6) });
      expect(decideAlertAction({ link: resolved, failing: true, hasQueuedEvent: false, now })).toBe('reopen');
    });

    it('reopens at exactly 7 days', () => {
      const resolved = link({ state: 'resolved', resolvedAt: daysAgo(7) });
      expect(decideAlertAction({ link: resolved, failing: true, hasQueuedEvent: false, now })).toBe('reopen');
    });

    it('opens a new ticket after 7 days', () => {
      const resolved = link({ state: 'resolved', resolvedAt: daysAgo(8) });
      expect(decideAlertAction({ link: resolved, failing: true, hasQueuedEvent: false, now })).toBe('create');
    });

    it('treats a ticket closed in Halo like a resolved one', () => {
      const closed = link({ state: 'closed_externally', resolvedAt: daysAgo(1) });
      expect(decideAlertAction({ link: closed, failing: true, hasQueuedEvent: false, now })).toBe('reopen');
    });

    it('creates when a resolved link never got a ticket', () => {
      const resolved = link({ state: 'resolved', haloTicketId: null, resolvedAt: daysAgo(1) });
      expect(decideAlertAction({ link: resolved, failing: true, hasQueuedEvent: false, now })).toBe('create');
    });
  });

  describe('passing', () => {
    it('ignores a pass with no link', () => {
      expect(decideAlertAction({ link: null, failing: false, hasQueuedEvent: false, now })).toBe('none');
    });

    it('resolves an open ticket', () => {
      expect(decideAlertAction({ link: link({}), failing: false, hasQueuedEvent: false, now })).toBe('resolve');
    });

    it('cancels a queued create', () => {
      const pending = link({ state: 'pending_create', haloTicketId: null });
      expect(decideAlertAction({ link: pending, failing: false, hasQueuedEvent: true, now })).toBe('cancel');
    });

    it('does nothing for an already resolved link', () => {
      const resolved = link({ state: 'resolved', resolvedAt: daysAgo(1) });
      expect(decideAlertAction({ link: resolved, failing: false, hasQueuedEvent: false, now })).toBe('none');
    });
  });
});
