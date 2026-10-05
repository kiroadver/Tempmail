"use strict";
const $ = (id) => document.getElementById(id);
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
let cfg = { domain: "", ttlMinutes: 60 },
  name = "",
  openId = null,
  messages = [],
  generation = 0,
  requestSequence = 0,
  openSequence = 0,
  toastTimer,
  connected = false,
  refreshing = false;
const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
const rand = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(10)),
    (b) => alphabet[b % alphabet.length],
  ).join("");
const fmt = (ts) =>
  new Date(ts).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function showErr(message = "") {
  $("err").textContent = message;
  $("err").hidden = !message;
}
function status(ok) {
  $("status").className = "status " + (ok ? "connected" : "offline");
  $("status-text").textContent = ok ? "Terhubung" : "Koneksi terputus";
}
function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2500);
}
function empty(title, text, reader = false) {
  const box = el("div", "empty" + (reader ? " reader-empty" : ""));
  box.append(
    el("span", "empty-icon", reader ? "▤" : "✉"),
    el("h3", "", title),
    el("p", "", text),
  );
  box.firstChild.setAttribute("aria-hidden", "true");
  return box;
}
function resetReader() {
  $("view").replaceChildren(
    empty(
      "Pesan Anda, di sini",
      "Pilih email di kotak masuk untuk membaca isi, menyalin OTP, atau membuka tautan.",
      true,
    ),
  );
}
async function copyText(value, button, success) {
  const original = button.textContent;
  try {
    if (navigator.clipboard && window.isSecureContext)
      await navigator.clipboard.writeText(value);
    else {
      const field = el("textarea", "sr-only", value);
      field.value = value;
      document.body.append(field);
      field.select();
      let copied;
      try {
        copied = document.execCommand("copy");
      } finally {
        field.remove();
        button.focus();
      }
      if (!copied) throw new Error("clipboard");
    }
    button.textContent = "Tersalin ✓";
    toast(success);
    setTimeout(() => (button.textContent = original), 1600);
  } catch {
    showErr(
      "Tidak bisa menyalin otomatis. Pilih dan salin teks secara manual, atau izinkan akses clipboard.",
    );
  }
}
function setName(n) {
  generation++;
  openSequence++;
  name = n;
  openId = null;
  messages = [];
  try {
    localStorage.setItem("tm-name", n);
  } catch {}
  $("addr").replaceChildren(
    document.createTextNode(n),
    el("span", "", "@" + cfg.domain),
  );
  resetReader();
  renderList([]);
  showErr();
  refresh();
}
async function refresh() {
  if (!name) return;
  const current = generation,
    seq = ++requestSequence,
    mailbox = name;
  refreshing = true;
  $("refresh").disabled = true;
  try {
    const r = await fetch("/api/inbox/" + encodeURIComponent(mailbox), {
      cache: "no-store",
    });
    if (!r.ok) throw new Error("inbox");
    const d = await r.json();
    if (!Array.isArray(d.messages)) throw new Error("format");
    if (current !== generation || seq !== requestSequence) return;
    messages = d.messages;
    renderList(messages);
    status(true);
    showErr();
    $("updated").textContent =
      "Diperbarui " +
      new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (openId && !messages.some((m) => m.id === openId)) {
      openId = null;
      openSequence++;
      resetReader();
    }
  } catch {
    if (current === generation && seq === requestSequence) {
      status(false);
      showErr("Gagal memuat email. Coba segarkan kotak masuk.");
    }
  } finally {
    if (seq === requestSequence) {
      refreshing = false;
      $("refresh").disabled = false;
    }
  }
}
function renderList(msgs) {
  $("count").textContent = msgs.length;
  if (!msgs.length) {
    $("list").replaceChildren(
      empty(
        "Belum ada email",
        "Gunakan alamat di atas. Email baru akan muncul otomatis di sini.",
      ),
    );
    return;
  }
  $("list").replaceChildren(
    ...msgs.map((m) => {
      const button = el("button", "item" + (m.id === openId ? " on" : ""));
      button.setAttribute("aria-pressed", String(m.id === openId));
      button.append(
        el("strong", "", m.subject || "(tanpa subjek)"),
        el("span", "sender", m.from),
        el("span", "preview", m.preview || "Buka untuk melihat isi email"),
        el("span", "time", fmt(m.ts)),
      );
      button.onclick = () => openMsg(m.id);
      return button;
    }),
  );
}
// Hanya HTTP(S). javascript:, data:, file:, kredensial URL, dan mailto: tidak dijadikan tombol.
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function emailDocument(html) {
  return new DOMParser().parseFromString(html || "", "text/html");
}
function visibleText(doc) {
  const copy = doc.body.cloneNode(true);
  copy
    .querySelectorAll("script,style,template,noscript,iframe,object")
    .forEach((n) => n.remove());
  copy.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  copy
    .querySelectorAll("p,div,td,tr,li,h1,h2,h3,h4,section")
    .forEach((n) => n.append("\n"));
  return copy.textContent || "";
}
function extractEmailActions(message) {
  const doc = emailDocument(message.html);
  const text = [
    message.subject || "",
    message.text || "",
    visibleText(doc),
  ].join("\n");
  const links = [],
    seenLinks = new Set();
  const addLink = (raw, label) => {
    const url = safeUrl(raw);
    if (!url || seenLinks.has(url)) return;
    seenLinks.add(url);
    links.push({
      url,
      label:
        (label || "").trim().replace(/\s+/g, " ").slice(0, 100) ||
        new URL(url).hostname,
    });
  };
  doc
    .querySelectorAll("a[href]")
    .forEach((a) => addLink(a.getAttribute("href"), a.textContent));
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi))
    addLink(match[0].replace(/[.,;:!?\])}]+$/, ""), "");
  // Pencarian heuristik: angka 4–8 digit, atau kode alfanumerik dekat kata OTP/kode.
  // URL/alamat email dibuang agar nomor tracking di tautan tidak terbaca sebagai OTP.
  const clean = text
    .replace(/https?:\/\/[^\s<>]+/gi, " ")
    .replace(/\b[^\s@]+@[^\s@]+\b/g, " ");
  const keyword =
    /\b(?:otp|one[- ]time(?:\s+(?:password|code))?|verification(?:\s+code)?|security(?:\s+code)?|passcode|kode(?:\s+(?:otp|verifikasi|keamanan|akses))?|code|pin)\b/gi;
  const codes = new Map();
  for (const context of clean.matchAll(keyword)) {
    const index = context.index,
      wordEnd = index + context[0].length;
    const nearby = clean.slice(
      Math.max(0, index - 70),
      Math.min(clean.length, wordEnd + 100),
    );
    const offset = Math.max(0, index - 70);
    const candidates = [];
    for (const candidate of nearby.matchAll(
      /\b(?:\d{3}[ -]\d{3}|\d{4,8}|[A-Z0-9]{4,10})\b/g,
    )) {
      const value = candidate[0].replace(/[ -]/g, ""),
        position = offset + candidate.index;
      if (
        !/\d/.test(value) ||
        /^\d{9,}$/.test(value) ||
        /^20\d{2}$/.test(value)
      )
        continue;
      const distance =
        position >= wordEnd
          ? position - wordEnd
          : index - (position + candidate[0].length);
      if (distance < 0 || distance > (position >= wordEnd ? 85 : 55)) continue;
      candidates.push({ value, score: distance + (position < index ? 12 : 0) });
    }
    candidates.sort((a, b) => a.score - b.score);
    if (candidates.length) {
      const c = candidates[0];
      codes.set(c.value, Math.min(codes.get(c.value) ?? Infinity, c.score));
    }
  }
  // Email dengan angka sebagai isi utama, meski tidak memakai kata "OTP".
  for (const line of clean.split("\n")) {
    const match = line.trim().match(/^(\d{4,8}|\d{3}[ -]\d{3})$/);
    if (match && !/^20\d{2}$/.test(match[1]))
      codes.set(match[1].replace(/[ -]/g, ""), 100);
  }
  return {
    codes: [...codes.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([code]) => code),
    links,
  };
}
function renderActions(actions) {
  if (!actions.codes.length && !actions.links.length) return null;
  const panel = el("section", "quick-actions");
  panel.setAttribute("aria-label", "Kode OTP dan tautan email");
  if (actions.codes.length) {
    panel.append(el("h3", "", "Kode OTP terdeteksi"));
    const grid = el("div", "otp-grid");
    actions.codes.forEach((code) => {
      const card = el("div", "otp-card"),
        button = el("button", "", "Salin OTP");
      button.setAttribute("aria-label", "Salin OTP " + code);
      button.onclick = () =>
        copyText(code, button, "Kode OTP berhasil disalin");
      card.append(el("span", "otp-code", code), button);
      grid.append(card);
    });
    panel.append(
      grid,
      el(
        "p",
        "detection-note",
        "Deteksi otomatis. Cocokkan kode dengan isi email sebelum digunakan.",
      ),
    );
  }
  if (actions.links.length) {
    const section = el("div", "links-section");
    section.append(el("h3", "", "Tautan dalam email"));
    const list = el("div", "link-list");
    actions.links.forEach((link) => {
      const row = el("div", "link-row"),
        info = el("div", "link-info"),
        url = el("span", "link-url", link.url);
      url.title = link.url;
      info.append(el("span", "link-label", link.label), url);
      const anchor = el("a", "link-button", "Buka ↗");
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.referrerPolicy = "no-referrer";
      anchor.setAttribute(
        "aria-label",
        "Buka tautan " + link.label + " di tab baru",
      );
      row.append(info, anchor);
      list.append(row);
    });
    section.append(
      list,
      el(
        "p",
        "link-warning",
        "Periksa alamat tujuan sebelum membuka. Tautan berasal dari pengirim email.",
      ),
    );
    panel.append(section);
  }
  return panel;
}
function safeEmailHtml(html) {
  const doc = emailDocument(html);
  doc
    .querySelectorAll(
      "script,iframe,object,embed,form,input,button,textarea,select,meta,base,link,svg,math,video,audio,source",
    )
    .forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes])
      if (
        /^on/i.test(attr.name) ||
        [
          "srcdoc",
          "srcset",
          "action",
          "formaction",
          "ping",
          "background",
        ].includes(attr.name)
      )
        node.removeAttribute(attr.name);
    if (node.hasAttribute("href")) {
      const url =
        node.tagName === "A" ? safeUrl(node.getAttribute("href")) : null;
      if (url) {
        node.setAttribute("href", url);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else node.removeAttribute("href");
    }
    if (
      node.hasAttribute("src") &&
      !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(
        node.getAttribute("src"),
      )
    )
      node.removeAttribute("src");
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{margin:20px;font:16px/1.6 system-ui,sans-serif;color:#202936;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#2364cc}pre{white-space:pre-wrap}</style></head><body>${[...doc.head.querySelectorAll("style")].map((n) => n.outerHTML).join("")}${doc.body.innerHTML}</body></html>`;
}
async function openMsg(id) {
  const current = generation,
    seq = ++openSequence,
    mailbox = name;
  openId = id;
  renderList(messages);
  $("view").replaceChildren(
    empty("Memuat email…", "Menyiapkan isi pesan dan tindakan cepat.", true),
  );
  try {
    const r = await fetch(
      `/api/inbox/${encodeURIComponent(mailbox)}/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!r.ok) throw new Error("message");
    const message = await r.json();
    if (current !== generation || seq !== openSequence) return;
    const head = el("header", "message-head"),
      meta = el("div", "message-meta");
    meta.append(
      el("span", "", message.from || "Pengirim tidak diketahui"),
      el("span", "", fmt(message.ts)),
    );
    head.append(el("h2", "", message.subject || "(tanpa subjek)"), meta);
    const actions = renderActions(extractEmailActions(message));
    let body;
    if (message.html) {
      body = el("iframe", "email-frame");
      body.title = "Isi email: " + (message.subject || "Tanpa subjek");
      body.setAttribute(
        "sandbox",
        "allow-popups allow-popups-to-escape-sandbox",
      );
      body.referrerPolicy = "no-referrer";
      body.srcdoc = safeEmailHtml(message.html);
    } else
      body = el(
        "pre",
        "email-text",
        message.text || "(Email ini tidak memiliki isi teks.)",
      );
    $("view").replaceChildren(
      head,
      ...(actions ? [actions] : []),
      el("div", "body-label", "Isi email"),
      body,
    );
  } catch {
    if (current === generation && seq === openSequence) {
      $("view").replaceChildren(
        empty(
          "Email tidak bisa dibuka",
          "Email mungkin sudah dihapus. Segarkan kotak masuk lalu coba lagi.",
          true,
        ),
      );
      showErr("Gagal membuka email. Silakan coba lagi.");
    }
  }
}
$("copy").onclick = () =>
  copyText(`${name}@${cfg.domain}`, $("copy"), "Alamat email berhasil disalin");
$("new").onclick = () => {
  if (
    messages.length &&
    !confirm(
      "Ganti alamat? Email di alamat lama tidak akan tampil di kotak masuk baru.",
    )
  )
    return;
  setName(rand());
  toast("Alamat baru siap digunakan");
};
$("custom-form").onsubmit = (event) => {
  event.preventDefault();
  if (!connected) return;
  const value = $("custom").value.trim().toLowerCase();
  if (!NAME_RE.test(value))
    return showErr(
      "Nama harus diawali huruf atau angka. Gunakan a–z, 0–9, titik, strip, atau underscore (maksimal 40 karakter).",
    );
  if (value === name) return;
  if (
    messages.length &&
    !confirm("Pakai alamat baru? Kotak masuk yang ditampilkan akan berganti.")
  )
    return;
  $("custom").value = "";
  setName(value);
};
$("refresh").onclick = () => refresh();
$("del").onclick = async () => {
  if (!messages.length) return toast("Kotak masuk sudah kosong");
  if (
    !confirm(
      "Hapus semua email di kotak masuk ini? Tindakan ini tidak bisa dibatalkan.",
    )
  )
    return;
  const current = generation,
    mailbox = name;
  $("del").disabled = true;
  try {
    const r = await fetch("/api/inbox/" + encodeURIComponent(mailbox), {
      method: "DELETE",
    });
    if (!r.ok) throw new Error("delete");
    if (current !== generation) return;
    openId = null;
    openSequence++;
    resetReader();
    toast("Semua email dihapus");
    await refresh();
  } catch {
    if (current === generation)
      showErr("Gagal menghapus email. Silakan coba lagi.");
  } finally {
    $("del").disabled = false;
  }
};
async function init() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) throw new Error("config");
    cfg = await r.json();
    if (!cfg.domain) throw new Error("domain");
    connected = true;
    document.title = "Temp Mail @" + cfg.domain;
    $("hint").textContent =
      `Email dihapus otomatis setelah ${cfg.ttlMinutes} menit tanpa aktivitas. Alamat ini tidak dilindungi kata sandi.`;
    ["copy", "new", "set", "refresh", "del"].forEach(
      (id) => ($(id).disabled = false),
    );
    let saved;
    try {
      saved = localStorage.getItem("tm-name");
    } catch {}
    setName(saved && NAME_RE.test(saved) ? saved : rand());
    setInterval(() => {
      if (!document.hidden && !refreshing) refresh();
    }, 5000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  } catch {
    status(false);
    showErr(
      "Konfigurasi gagal dimuat. Periksa koneksi lalu muat ulang halaman.",
    );
    $("addr").textContent = "Alamat belum tersedia";
    $("list").replaceChildren(
      empty("Belum terhubung", "Muat ulang halaman untuk mencoba lagi."),
    );
  }
}
init();
