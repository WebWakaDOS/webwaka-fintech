/**
 * WebWaka Event Bus Publisher
 *
 * Invariant 1: Event-Driven Architecture
 * All cross-repo state changes are communicated via events, not direct API calls.
 *
 * Published events in this module:
 *   - `payout.completed`  — fired after NIBSS NIP transfer is confirmed
 *   - `payout.failed`     — fired after a transfer is definitively rejected/reversed
 *
 * Consumers:
 *   - webwaka-commerce    — vendor payout ledger updates
 *   - webwaka-logistics   — rider commission ledger updates
 *   - webwaka-transport   — driver settlement ledger updates
 *
 * The Event Bus URL and secret are optional bindings. When absent (e.g. local dev),
 * events are logged to console and silently skipped — the payout still succeeds.
 */

export interface PayoutCompletedEvent {
  event: 'payout.completed';
  payoutRequestId: string;
  tenantId: string;
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  destinationAccountNumber: string;
  destinationBankCode: string;
  destinationAccountName: string;
  nibssReference: string;
  nibssSessionId: string;
  settledAt: string;
}

export interface PayoutFailedEvent {
  event: 'payout.failed';
  payoutRequestId: string;
  tenantId: string;
  initiatorId: string;
  payoutType: string;
  amountKobo: number;
  nibssReference: string;
  failureReason: string;
  failedAt: string;
}

export type WebWakaEvent = PayoutCompletedEvent | PayoutFailedEvent;

/**
 * Publish an event to the WebWaka Event Bus.
 *
 * Delivery is fire-and-forget (no retry) — the Event Bus is responsible for
 * durability and fan-out to subscribers. This function never throws; failures
 * are logged so the caller's payout flow is never blocked by bus errors.
 */
export async function publishEvent(
  eventBusUrl: string | undefined,
  eventBusSecret: string | undefined,
  event: WebWakaEvent
): Promise<void> {
  if (!eventBusUrl) {
    console.log(`[EventBus] No EVENT_BUS_URL configured — skipping event: ${event.event}`, {
      payoutRequestId: (event as PayoutCompletedEvent).payoutRequestId,
    });
    return;
  }

  try {
    const resp = await fetch(`${eventBusUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(eventBusSecret ? { 'X-Bus-Secret': eventBusSecret } : {}),
      },
      body: JSON.stringify(event),
    });

    if (!resp.ok) {
      console.error(`[EventBus] Failed to publish ${event.event}: HTTP ${resp.status}`);
    } else {
      console.log(`[EventBus] Published ${event.event} successfully`);
    }
  } catch (err) {
    // Never let event bus errors block the caller
    console.error(`[EventBus] Exception publishing ${event.event}:`, err);
  }
}
