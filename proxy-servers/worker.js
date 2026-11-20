// Cloudflare Worker web proxy.
// Open:  https://YOUR-WORKER.workers.dev/?url=https://example.com
// Links, images, scripts and redirects on the page are rewritten to keep going through the proxy.

export default {
  async fetch(request) {
    const self = new URL(request.url);
    const wrap = (u) => self.origin + "/?url=" + encodeURIComponent(u);

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

    // Build the outgoing request without leaking the visitor's cookies or IP headers.
    const headers = new Headers(request.headers);
    for (const h of ["host", "cookie", "origin", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) {
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
      });
    } catch (e) {
      return new Response("Couldn't reach that site: " + e.message, { status: 502 });
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
