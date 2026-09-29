"use client";

/* Last-resort boundary: the root layout itself failed, so there are no
   providers (no i18n, no theme) — plain markup and fixed English copy. It
   replaces the root layout, hence its own <html>/<body>. */
import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" data-theme="dark">
      <body style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>DevDigest failed to load</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            Something went wrong while starting the app. Try again — if it keeps failing, check that the API is
            running.
          </p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
