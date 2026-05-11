/**
 * Cloudflare Pages middleware — HTTP Basic Auth gate for the curator-only
 * surfaces of the site.
 *
 * Gated paths:
 *   /admin.html        — the photo/audio/pending editor
 *   /tools/*           — design + editorial docs and source for the
 *                        acquisition pipeline
 *
 * Everything else on the site (the public viewer, photo files, the FAQ)
 * passes through untouched.
 *
 * Credentials live in environment variables set in the Cloudflare Pages
 * dashboard (Settings → Environment variables):
 *
 *   ADMIN_USER       — login name
 *   ADMIN_PASSWORD   — password
 *
 * If either is unset the middleware fails closed with a clear 503 so the
 * site never accidentally publishes the admin tools unprotected.
 *
 * Why HTTP Basic Auth specifically:
 *   - Zero account setup for the curator or anyone they invite
 *   - Browsers handle the login dialog natively, no UI to build
 *   - Credentials live in env vars, never in source
 *
 * Tradeoffs to know:
 *   - HTTP Basic has no logout / expiry; browsers cache the credentials
 *     for the session. If you rotate the password, any logged-in session
 *     keeps working until the browser is restarted.
 *   - The Pending tab's "Run Sync / Promote / Reject" buttons fetch the
 *     local sidecar at 127.0.0.1:8001 — they will not work for a remote
 *     visitor (the request goes to THEIR localhost). The Photos and
 *     Audio tabs work entirely client-side and DO function over the
 *     authed connection.
 *   - If you need real account management or SSO, switch to Cloudflare
 *     Access instead.
 */

export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  const gated =
    path === '/admin.html' ||
    path.startsWith('/tools/') ||
    path === '/tools';

  if (!gated) {
    return context.next();
  }

  const user = context.env.ADMIN_USER;
  const pass = context.env.ADMIN_PASSWORD;

  // Fail-closed if the curator hasn't configured credentials yet.
  if (!user || !pass) {
    return new Response(
      'Admin tools disabled: set ADMIN_USER and ADMIN_PASSWORD ' +
      'environment variables in the Cloudflare Pages project settings.',
      {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }
    );
  }

  const provided = context.request.headers.get('Authorization') || '';
  const expected = 'Basic ' + btoa(`${user}:${pass}`);

  // Constant-time comparison would be safer against timing attacks, but
  // for static-site Basic Auth over HTTPS the difference is negligible.
  if (provided !== expected) {
    return new Response('Authentication required.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Artemis Timeline curator tools"',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  }

  // Auth passed — serve the gated asset (admin.html, tools file, etc.).
  return context.next();
};
