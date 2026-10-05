const { chromium } = require("playwright");
const fs = require("fs"),
  http = require("http"),
  path = require("path"),
  assert = require("assert");
const root = path.resolve(__dirname, "../public");
const email = {
  id: "demo",
  subject: "Kode verifikasi akun Anda",
  from: "Acme Security <security@example.com>",
  ts: Date.now(),
  text: "Kode OTP Anda: 482916\nKode berlaku selama 10 menit.\nVerifikasi akun: https://example.com/verify?token=sample",
  html: '<h2>Verifikasi akun Anda</h2><p>Gunakan kode berikut untuk melanjutkan:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">482916</p><p>Kode berlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.</p><p><a href="https://example.com/verify?token=sample">Verifikasi akun</a></p>',
};
const messages = [
  email,
  {
    id: "welcome",
    subject: "Selamat datang di Acme",
    from: "Acme Team <hello@example.com>",
    ts: Date.now() - 300000,
    text: "Akun Anda siap digunakan.",
    preview: "Akun Anda siap digunakan.",
  },
].map((m) => ({
  ...m,
  preview: m.preview || "Kode OTP Anda: 482916. Kode berlaku 10 menit.",
}));
const config = { domain: "wanzabigail.my.id", ttlMinutes: 60 };
const server = http.createServer((req, res) => {
  let file = path.join(root, req.url === "/" ? "index.html" : req.url);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
(async () => {
  await new Promise((r) => server.listen(8097, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  let list = messages;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const u = route.request().url();
    if (route.request().method() === "DELETE") {
      list = [];
      return route.fulfill({ status: 204 });
    }
    await route.fulfill({
      json: u.endsWith("/api/config")
        ? config
        : u.endsWith("/demo")
          ? email
          : { messages: list },
    });
  });
  await page.goto("http://127.0.0.1:8097");
  await page.locator(".item").first().waitFor();
  await page.locator(".item").first().click();
  await page.locator(".otp-code").waitFor();
  assert.equal(await page.locator(".otp-code").innerText(), "482916");
  assert.equal(await page.locator(".link-button").count(), 1);
  assert.equal(
    await page.locator(".link-button").getAttribute("rel"),
    "noopener noreferrer",
  );
  await page.getByRole("button", { name: "Salin OTP 482916" }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "482916",
  );
  await page.locator("#copy").click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /@wanzabigail\.my\.id$/,
  );
  const cases = [
    [
      { subject: "OTP", text: "Your verification code is 654321" },
      ["654321"],
      0,
    ],
    [{ subject: "Login", text: "Kode OTP: A1B2C3" }, ["A1B2C3"], 0],
    [{ subject: "Login", text: "Your code is 123 456" }, ["123456"], 0],
    [{ subject: "Login", html: "<p>OTP Anda</p><b>001234</b>" }, ["001234"], 0],
    [{ subject: "Code", text: "https://example.com/123456?x=99" }, [], 1],
    [
      {
        subject: "Invoice",
        text: "Total pembayaran 123456 rupiah. Tahun 2026.",
      },
      [],
      0,
    ],
    [{ subject: "OTP", text: "Nomor telepon +6281234567890" }, [], 0],
    [
      {
        subject: "Notice",
        text: "Your package shipped.",
        html: '<a href="javascript:alert(1)">Bad</a><a href="data:text/html,test">Bad</a><a href="https://example.com/ok">Okay</a><a href="https://example.com/ok">Duplicate</a>',
      },
      [],
      1,
    ],
    [
      { subject: "Security", text: "123456\nhttps://example.com/verify." },
      ["123456"],
      1,
    ],
  ];
  for (const [m, codes, links] of cases) {
    const a = await page.evaluate((m) => extractEmailActions(m), m);
    assert.deepEqual(a.codes, codes, JSON.stringify(m));
    assert.equal(a.links.length, links);
  }
  const sanitized = await page.evaluate(() =>
    safeEmailHtml(
      '<script>alert(1)</script><form action="https://evil.example"><input></form><img src="https://tracker.example/pixel" onerror="alert(1)"><a href="javascript:alert(1)">Bad</a><a href="https://example.com">Okay</a>',
    ),
  );
  assert(!sanitized.includes("<script"));
  assert(!sanitized.includes("onerror"));
  assert(!sanitized.includes("https://tracker"));
  assert(!sanitized.includes("javascript:"));
  assert(sanitized.includes("form-action"));
  await page.locator("#custom").fill("!bad");
  await page.locator("#set").click();
  assert(await page.locator("#err").isVisible());
  await page.locator("#custom").fill("tester");
  page.on("dialog", (d) => d.accept());
  await page.locator("#set").click();
  assert.match(await page.locator("#addr").innerText(), /^tester@/);
  await page.locator("#del").click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".item").count(), 0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 9 extraction cases; copy OTP/address; safe links and HTML; custom validation; delete; responsive overflow; no browser errors.",
  );
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
