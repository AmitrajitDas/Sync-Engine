import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionRegistry } from "../../src/realtime/subscriptionRegistry.js";
import type { WebSocket } from "@fastify/websocket";

function makeSocket(state: number = 1): WebSocket {
  return {
    readyState: state,
    OPEN: 1,
    send: vi.fn(),
    ping: vi.fn(),
    on: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe("SubscriptionRegistry", () => {
  let registry: SubscriptionRegistry;

  beforeEach(() => {
    registry = new SubscriptionRegistry();
  });

  it("notifies sockets subscribed to a bucket", () => {
    const socket = makeSocket();
    registry.add(socket, ["tenant:t1:region:north"]);
    registry.notify("tenant:t1:region:north", 42);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "checkpoint", bucket: "tenant:t1:region:north", seq: 42 }),
    );
  });

  it("does not notify socket subscribed to different bucket", () => {
    const socket = makeSocket();
    registry.add(socket, ["tenant:t1:region:south"]);
    registry.notify("tenant:t1:region:north", 42);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("removes socket cleanly", () => {
    const socket = makeSocket();
    registry.add(socket, ["tenant:t1:region:north"]);
    registry.remove(socket);
    expect(registry.size()).toBe(0);
    registry.notify("tenant:t1:region:north", 1);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("does not send to closed socket", () => {
    const closedSocket = makeSocket(3); // CLOSED
    registry.add(closedSocket, ["tenant:t1:region:north"]);
    registry.notify("tenant:t1:region:north", 1);
    expect(closedSocket.send).not.toHaveBeenCalled();
  });

  it("tracks size correctly", () => {
    const s1 = makeSocket();
    const s2 = makeSocket();
    registry.add(s1, ["bucket:a"]);
    registry.add(s2, ["bucket:a", "bucket:b"]);
    expect(registry.size()).toBe(2);
    registry.remove(s1);
    expect(registry.size()).toBe(1);
  });
});
