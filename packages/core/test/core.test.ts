import { describe, expect, it, vi } from "vitest";
import { DataNet, DataNetError } from "../src/index.js";

describe("DataNetError", () => {
  it("carries structured gateway error details", () => {
    const err = new DataNetError({
      code: "channel_not_allowed",
      message: "DataNet: channel not allowed",
      channel: "project.x.demo",
      retryMs: 1500,
      scope: "pub",
      status: 403,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DataNetError");
    expect(err.code).toBe("channel_not_allowed");
    expect(err.channel).toBe("project.x.demo");
    expect(err.retryMs).toBe(1500);
    expect(err.scope).toBe("pub");
    expect(err.status).toBe(403);
  });
});

describe("DataNet", () => {
  it("is not connected before connect()", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    expect(client.connected).toBe(false);
  });

  it("supports chained subscribe/publish/unsubscribe before connecting", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const handler = vi.fn();

    expect(() => {
      client.subscribe("project.x.demo", handler).publish("project.x.demo", { hello: 1 }).unsubscribe("project.x.demo");
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("registers and removes event listeners", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    const onError = vi.fn();
    client.on("error", onError);
    client.off("error", onError);
    expect(client.connected).toBe(false);
  });

  it("rejects connect() when the auth endpoint is unreachable", async () => {
    const client = new DataNet({
      apiKey: "ak_test",
      apiUrl: "http://127.0.0.1:1", // nothing listens here
    });
    const onError = vi.fn();
    client.on("error", onError);

    await expect(client.connect()).rejects.toThrow(/authentication/);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("disconnect() is safe to call before connect()", () => {
    const client = new DataNet({ apiKey: "ak_test" });
    expect(() => client.disconnect()).not.toThrow();
    expect(client.connected).toBe(false);
  });
});
