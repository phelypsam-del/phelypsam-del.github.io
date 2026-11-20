// Cloudflare Worker web proxy.
// Open:  https://YOUR-WORKER.workers.dev/?url=https://example.com
// Links, images, scripts and redirects on the page are rewritten to keep going through the proxy.
//
// Optional environment variables (Worker settings -> Variables):
//   ACCESS_TOKEN   if set, requests must include ?token=... (or header X-Proxy-Token) to be served.
//   ALLOWED_HOSTS  comma-separated domains; if set, only these (and subdomains) may be fetched.

const MAX_BODY = 25 * 1024 * 1024;              // refuse to proxy responses larger than this
const OK_METHODS = new Set(["GET", "HEAD", "POST"]);

export default {
  async fetch(request, env) {
    const self = new URL(request.url);
    const token = self.searchParams.get("token") || request.headers.get("x-proxy-token");
    const wrap = (u) => {
      const w = self.origin + "/?url=" + encodeURIComponent(u);
      return env.ACCESS_TOKEN ? w + "&token=" + encodeURIComponent(token || "") : w;
    };

    if (env.ACCESS_TOKEN && token !== env.ACCESS_TOKEN) {
      return new Response("Access denied.", { status: 401 });
    }
    if (!OK_METHODS.has(request.method)) {
      return new Response("Method not allowed.", { status: 405 });
    }

    const raw = self.searchParams.get("url");
    if (!raw) {
      return new Response("Proxy is running. Add ?url=https://example.com to the address.", {
        headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" },
      });
    }

    let target;
    try {
      target = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    } catch {
      return new Response("That isn't a valid web address.", { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return new Response("Only http and https addresses work.", { status: 400 });
    }

    // Host allowlist (optional).
    if (env.ALLOWED_HOSTS) {
      const allow = env.ALLOWED_HOSTS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const host = target.hostname.toLowerCase();
      if (!allow.some((d) => host === d || host.endsWith("." + d))) {
        return new Response("That site is not on this proxy's allowlist.", { status: 403 });
      }
    }

    // Build the outgoing request without leaking the visitor's cookies or IP headers.
    const headers = new Headers(request.headers);
    for (const h of ["host", "cookie", "origin", "cf-connecting-ip", "x-forwarded-for", "x-real-ip", "x-proxy-token"]) {
      headers.delete(h);
    }
    headers.set("referer", target.origin + "/");

    let resp;
    try {
      resp = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      const msg = e.name === "TimeoutError" ? "The site took too long to respond." : "Couldn't reach that site: " + e.message;
      return new Response(msg, { status: 504 });
    }

    const len = Number(resp.headers.get("content-length") || 0);
    if (len && len > MAX_BODY) {
      return new Response("That response is too large to proxy.", { status: 413 });
    }

    const out = new Headers(resp.headers);
    const loc = out.get("location");
    if (loc) out.set("location", wrap(new URL(loc, target).href));
    for (const h of [
      "content-security-policy",
      "content-security-policy-report-only",
      "x-frame-options",
      "set-cookie",
      "strict-transport-security",
    ]) {
      out.delete(h);
    }
    out.set("access-control-allow-origin", "*");

    const type = out.get("content-type") || "";
    if (!type.includes("text/html")) {
      return new Response(resp.body, { status: resp.status, headers: out });
    }

    const rewrite = (attr) => ({
      element(el) {
        const v = el.getAttribute(attr);
        if (!v || /^(data:|javascript:|blob:|mailto:|tel:|#)/i.test(v)) return;
        try {
          el.setAttribute(attr, wrap(new URL(v, target).href));
        } catch {}
      },
    });

    return new HTMLRewriter()
      .on("a[href]", rewrite("href"))
      .on("link[href]", rewrite("href"))
      .on("img[src]", rewrite("src"))
      .on("script[src]", rewrite("src"))
      .on("iframe[src]", rewrite("src"))
      .on("source[src]", rewrite("src"))
      .on("video[src]", rewrite("src"))
      .on("audio[src]", rewrite("src"))
      .on("form[action]", rewrite("action"))
      .on("img[srcset]", { element(el) { el.removeAttribute("srcset"); } })
      .transform(new Response(resp.body, { status: resp.status, headers: out }));
  },
};
