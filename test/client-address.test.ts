import { describe, expect, it } from "vitest";
import { clientAddress, trustedHops } from "@/lib/http/client-address";

const req = (headers: Record<string, string>) => new Headers(headers);

/**
 * Every rate limit in the app keys on this. The cases that matter are the ones
 * where a caller writes the header themselves.
 */
describe("clientAddress", () => {
  it("reads the client from a single trusted proxy", () => {
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.5" }), 1)).toBe(
      "203.0.113.5",
    );
  });

  it("ignores a spoofed entry prepended by the caller", () => {
    /*
     * The regression this file exists for. A caller sending their own
     * X-Forwarded-For gets it *appended to*, not replaced — so the leftmost
     * value is theirs and the rightmost is what the proxy actually saw.
     */
    const spoofed = req({ "x-forwarded-for": "1.2.3.4, 203.0.113.5" });
    expect(clientAddress(spoofed, 1)).toBe("203.0.113.5");
    expect(clientAddress(spoofed, 1)).not.toBe("1.2.3.4");
  });

  it("cannot be steered onto a chosen victim's address", () => {
    // Sending the owner's IP must not let a stranger fill the owner's bucket.
    const targeted = req({ "x-forwarded-for": "198.51.100.9, 203.0.113.5" });
    expect(clientAddress(targeted, 1)).toBe("203.0.113.5");
  });

  it("counts back through two trusted proxies", () => {
    expect(
      clientAddress(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }), 2),
    ).toBe("203.0.113.5");
  });

  it("trusts nothing when the app is directly reachable", () => {
    expect(clientAddress(req({ "x-forwarded-for": "1.2.3.4" }), 0)).toBeNull();
    expect(clientAddress(req({ "x-real-ip": "1.2.3.4" }), 0)).toBeNull();
  });

  it("refuses a chain shorter than the configured hop count", () => {
    // Fewer entries than there are trusted proxies means the request did not
    // arrive the way the deployment says. Nothing in it can be relied on.
    expect(clientAddress(req({ "x-forwarded-for": "1.2.3.4" }), 2)).toBeNull();
  });

  it("falls back to x-real-ip only when a proxy is trusted", () => {
    expect(clientAddress(req({ "x-real-ip": "203.0.113.5" }), 1)).toBe("203.0.113.5");
  });

  it("prefers the chain over x-real-ip", () => {
    const both = req({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "9.9.9.9" });
    expect(clientAddress(both, 1)).toBe("203.0.113.5");
  });

  it("returns null when there is nothing to read", () => {
    expect(clientAddress(req({}), 1)).toBeNull();
  });

  it("normalizes so one peer is one bucket", () => {
    // Port, brackets, IPv6-mapped IPv4 and case all vary by proxy; treating
    // them as different keys would hand out extra allowances for free.
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.5:41234" }), 1)).toBe("203.0.113.5");
    expect(clientAddress(req({ "x-forwarded-for": "[2001:db8::1]:443" }), 1)).toBe("2001:db8::1");
    expect(clientAddress(req({ "x-forwarded-for": "::ffff:203.0.113.5" }), 1)).toBe("203.0.113.5");
    expect(clientAddress(req({ "x-forwarded-for": "2001:DB8::1" }), 1)).toBe("2001:db8::1");
  });

  it("does not truncate a bare IPv6 address at its first colon", () => {
    expect(clientAddress(req({ "x-forwarded-for": "2001:db8::1" }), 1)).toBe("2001:db8::1");
  });

  it("tolerates whitespace and empty entries", () => {
    expect(clientAddress(req({ "x-forwarded-for": " 1.2.3.4 ,  , 203.0.113.5 " }), 1)).toBe(
      "203.0.113.5",
    );
  });
});

describe("trustedHops", () => {
  it("defaults to one on Vercel and zero elsewhere", () => {
    // Vercel always terminates at its own edge, so one entry is real there.
    // Anywhere else, assuming a proxy exists would trust a forgeable header.
    expect(trustedHops(undefined, true)).toBe(1);
    expect(trustedHops(undefined, false)).toBe(0);
  });

  it("honours an explicit zero even on Vercel", () => {
    expect(trustedHops("0", true)).toBe(0);
  });

  it("ignores values that are not counts", () => {
    for (const bad of ["", "yes", "-1", "1.5", "abc"]) {
      expect(trustedHops(bad, false)).toBe(0);
      expect(trustedHops(bad, true)).toBe(1);
    }
  });
});
