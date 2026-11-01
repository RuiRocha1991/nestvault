import {
  markReadRequest,
  registerRequest,
  type PlanReminderView,
} from '@webapp/lib/plan-reminders-view';

/** What the user is told after an action; each one is a message in `notifications.planReminder`. */
export type ReminderNotice = 'registered' | 'notFound' | 'forbidden' | 'inactive' | 'failed';

export interface ReminderActionDeps {
  post: (path: string, body: unknown) => Promise<{ ok: boolean; status: number }>;
  /** Re-reads the server data, so a stale row goes away. */
  refresh: () => void;
  notify: (notice: ReminderNotice) => void;
  /** The reminder a request is running for (null when none): drives the busy state. */
  setBusy: (id: string | null) => void;
  /** Runs after a request succeeded, before the refresh (moves focus off the row). */
  settled: () => void;
}

const FAILURES: Readonly<Record<number, ReminderNotice>> = {
  403: 'forbidden',
  404: 'notFound',
  409: 'inactive',
};

/**
 * The two actions of a reminder. One request runs at a time (a second click while one is in flight
 * is ignored). Any answer that is not ok (404 for a reminder or plan that is gone, 409 for a paused
 * plan, a buy already registered by someone else, ...) refreshes the data and says why.
 */
export function createReminderActions(poolId: string, deps: ReminderActionDeps) {
  let inFlight = false;

  async function send(id: string, request: { path: string; body: unknown }, done?: ReminderNotice) {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(id);
    try {
      const response = await deps.post(request.path, request.body);
      if (response.ok) {
        if (done) deps.notify(done);
        deps.settled();
      } else {
        deps.notify(FAILURES[response.status] ?? 'failed');
      }
      deps.refresh();
    } catch {
      deps.notify('failed');
    } finally {
      inFlight = false;
      deps.setBusy(null);
    }
  }

  return {
    register: (reminder: PlanReminderView) =>
      send(reminder.id, registerRequest(poolId, reminder), 'registered'),
    markRead: (reminder: PlanReminderView) => send(reminder.id, markReadRequest(poolId, reminder)),
  };
}
