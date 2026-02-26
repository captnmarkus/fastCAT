type CounterName =
  | "chat_requests_total"
  | "chat_request_errors_total"
  | "chat_tool_calls_total";

export class ChatMetrics {
  private counters = new Map<CounterName, number>();

  increment(name: CounterName) {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + 1);
  }

  get(name: CounterName) {
    return this.counters.get(name) ?? 0;
  }
}

export const chatMetrics = new ChatMetrics();
