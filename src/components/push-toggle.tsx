"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Turning notifications on for this device.
 *
 * Subscriptions are per browser install, not per account, so this is a device
 * question rather than a setting — and the state has to be read from the
 * browser rather than the database, because a permission revoked in browser
 * settings leaves the server's row looking perfectly healthy.
 *
 * The permission prompt is only ever raised from a click. Asking on page load
 * is the reliable way to get "Block" forever, which cannot be undone from
 * inside the app.
 */

/**
 * VAPID keys arrive base64url; `applicationServerKey` wants raw bytes.
 *
 * Typed as ArrayBuffer rather than Uint8Array because the DOM signature
 * rejects a Uint8Array whose backing buffer might be shared.
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

type State =
  | "loading"
  | "unsupported"
  /** iOS Safari, not yet installed — supported, but only once added. */
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "off"
  | "on";

/**
 * iPadOS reports itself as a Mac, and has done for years. Touch points are the
 * usual way to tell it apart from a desktop.
 */
function isApplePortable(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** Launched from the Home Screen or Dock rather than a browser tab. */
function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, predating the standard and still the only one it sets.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
        setState("unsupported");
        return;
      }

      if (!("PushManager" in window)) {
        /*
         * On iOS this is not a dead end, which is what the old message implied.
         * Safari does support web push — it just withholds the API entirely
         * until the site is installed to the Home Screen, so the fix is a
         * three-tap instruction rather than "your browser cannot do this".
         */
        setState(isApplePortable() && !isInstalled() ? "needs-install" : "unsupported");
        return;
      }

      const res = await fetch("/api/push/subscribe");
      const data = await res.json();
      if (!data.configured || !data.publicKey) {
        setState("unconfigured");
        return;
      }
      setPublicKey(data.publicKey);

      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      // The browser is the authority on whether this device is subscribed.
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push that shows nothing is not allowed.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");

      setState("on");
      setMessage("This device will receive alerts.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
      setMessage("This device will no longer receive alerts.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      setMessage(
        data.sent > 0
          ? `Sent to ${data.sent} device${data.sent === 1 ? "" : "s"}.`
          : "No device received it — check that alerts are on for this browser.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  if (state === "loading") return null;

  if (state === "unsupported") {
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        This browser does not support web push.
      </p>
    );
  }

  if (state === "needs-install") {
    return (
      <div className="mt-3 space-y-2 text-sm text-[var(--color-ink-muted)]">
        <p>
          iOS only allows notifications once Loot is installed. Add it to
          your Home Screen, then open it from there and come back to this page.
        </p>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            Tap <span className="text-[var(--color-ink)]">Share</span> in
            Safari&rsquo;s toolbar
          </li>
          <li>
            Choose{" "}
            <span className="text-[var(--color-ink)]">Add to Home Screen</span>
          </li>
          <li>Open Loot from the new icon</li>
        </ol>
      </div>
    );
  }

  if (state === "unconfigured") {
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        Set <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> to
        turn alerts on. Generate them with <code>pnpm push:keys</code>.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        Notifications are blocked for this site. That has to be undone in your
        browser&rsquo;s site settings — an app cannot re-ask once refused.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {state === "on" ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={disable}>
              Turn off for this device
            </button>
            <button type="button" className="btn" disabled={busy} onClick={test}>
              Send a test
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={enable}
          >
            {busy ? "Enabling…" : "Enable on this device"}
          </button>
        )}
      </div>
      {message ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{message}</p>
      ) : null}
    </div>
  );
}
