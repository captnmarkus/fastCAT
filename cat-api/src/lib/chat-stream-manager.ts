export type ChatStreamEventType = "token" | "final" | "tool_call" | "error";

export type ChatStreamEvent = {
  id: number;
  type: ChatStreamEventType;
  data: Record<string, unknown>;
};

type ChatStreamListener = (event: ChatStreamEvent) => void;

type ChatStreamSession = {
  requestId: string;
  userId: number;
  threadId: number;
  createdAt: number;
  expiresAt: number;
  done: boolean;
  nextEventId: number;
  events: ChatStreamEvent[];
  listeners: Set<ChatStreamListener>;
};

const DEFAULT_ACTIVE_TTL_MS = 15 * 60_000;
const DEFAULT_DONE_TTL_MS = 3 * 60_000;

export class ChatStreamManager {
  private sessions = new Map<string, ChatStreamSession>();

  createSession(params: { requestId: string; userId: number; threadId: number }) {
    this.cleanup();
    const now = Date.now();
    this.sessions.set(params.requestId, {
      requestId: params.requestId,
      userId: params.userId,
      threadId: params.threadId,
      createdAt: now,
      expiresAt: now + DEFAULT_ACTIVE_TTL_MS,
      done: false,
      nextEventId: 1,
      events: [],
      listeners: new Set()
    });
  }

  getSession(requestId: string) {
    this.cleanup();
    return this.sessions.get(requestId) ?? null;
  }

  subscribe(requestId: string, listener: ChatStreamListener) {
    const session = this.getSession(requestId);
    if (!session) {
      return null;
    }
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  getEventsSince(requestId: string, lastEventId: number) {
    const session = this.getSession(requestId);
    if (!session) return [];
    return session.events.filter((event) => event.id > lastEventId);
  }

  pushEvent(requestId: string, type: ChatStreamEventType, data: Record<string, unknown>) {
    const session = this.getSession(requestId);
    if (!session) return null;

    const event: ChatStreamEvent = {
      id: session.nextEventId,
      type,
      data
    };
    session.nextEventId += 1;
    session.events.push(event);
    session.listeners.forEach((listener) => listener(event));
    return event;
  }

  markDone(requestId: string) {
    const session = this.getSession(requestId);
    if (!session) return;
    session.done = true;
    session.expiresAt = Date.now() + DEFAULT_DONE_TTL_MS;
  }

  cleanup() {
    const now = Date.now();
    for (const [requestId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(requestId);
      }
    }
  }
}
