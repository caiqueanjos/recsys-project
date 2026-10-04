import type { Session, StoreEvent } from '@store/contracts';
import { ApiError, request } from './api';
type Observation = Pick<StoreEvent, 'id' | 'type' | 'occurredAt' | 'context'>;
export class Telemetry {
  pending: Observation[] = [];
  sending = false;
  stopped = false;
  timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly session: Session,
    readonly report: (message: string) => void,
  ) {}
  record(type: Observation['type'], context: Observation['context']) {
    const event = { id: crypto.randomUUID(), type, occurredAt: new Date().toISOString(), context };
    this.pending.push(event);
    void this.flush();
    return event.id;
  }
  async flush() {
    if (this.sending || !this.pending.length || this.stopped) return;
    this.sending = true;
    const batch = this.pending.slice(0, 100);
    try {
      await request('/events', this.session.id, { events: batch });
      this.pending.splice(0, batch.length);
    } catch (error) {
      this.report(`Activity recording: ${(error as Error).message}`);
      if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
        // Expired or invalid sessions cannot accept this queue; avoid retrying it into the next identity.
        this.stopped = true;
      } else {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush();
        }, 5000);
      }
    } finally {
      this.sending = false;
      if (this.pending.length && !this.timer) void this.flush();
    }
  }
  close() {
    // Send queued observations with their original identity before retiring this session.
    if (this.pending.length) {
      void this.flush();
      return;
    }
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
