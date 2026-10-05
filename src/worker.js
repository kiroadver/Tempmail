import PostalMime from 'postal-mime';
import { DurableObject } from 'cloudflare:workers';

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const MAX_MSGS = 50;

// Satu Durable Object = satu kotak masuk. Terhapus otomatis lewat alarm setelah TTL.
export class Mailbox extends DurableObject {
  touched = 0;
  ttl() { return (Number(this.env.TTL_MINUTES) || 60) * 60000; }

  async keepAlive(force) {
    const now = Date.now();
    if (force || now - this.touched > 60000) {
      this.touched = now;
      await this.ctx.storage.setAlarm(now + this.ttl());
    }
  }
  async all() {
    const map = await this.ctx.storage.list({ prefix: 'm:' });
    return [...map.values()].sort((a, b) => b.ts - a.ts);
  }
  async add(msg) {
    await this.ctx.storage.put(`m:${msg.id}`, msg);
    const all = await this.all();
    if (all.length > MAX_MSGS) await this.ctx.storage.delete(all.slice(MAX_MSGS).map((m) => `m:${m.id}`));
    await this.keepAlive(true);
  }
  async list() {
    await this.keepAlive(false);
    return (await this.all()).map(({ id, from, subject, ts, text }) => ({
      id, from, subject, ts, preview: text.replace(/\s+/g, ' ').slice(0, 120),
    }));
  }
  get(id) { return this.ctx.storage.get(`m:${id}`); }
  async clear() { await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm(); }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

const boxOf = (env, name) => env.MAILBOX.get(env.MAILBOX.idFromName(name));

export default {
  // Website tampil dari folder public/. Worker hanya menangani /api/*
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/config') {
      return Response.json({ domain: env.MAIL_DOMAIN, ttlMinutes: Number(env.TTL_MINUTES) || 60 });
    }
    const [, api, kind, rawName = '', id] = pathname.split('/');
    if (api !== 'api' || kind !== 'inbox') return new Response('Not found', { status: 404 });
    const name = rawName.toLowerCase();
    if (!NAME_RE.test(name)) {
      return Response.json({ error: 'Nama tidak valid (a-z, 0-9, titik, strip, maks 40 karakter)' }, { status: 400 });
    }
    const box = boxOf(env, name);
    if (req.method === 'DELETE') { await box.clear(); return new Response(null, { status: 204 }); }
    if (id) {
      const m = await box.get(id);
      return m ? Response.json(m) : new Response('Not found', { status: 404 });
    }
    return Response.json({ address: `${name}@${env.MAIL_DOMAIN}`, messages: await box.list() });
  },

  // Email masuk dari Cloudflare Email Routing (catch-all)
  async email(message, env) {
    if (message.rawSize > 5 * 1024 * 1024) return message.setReject('Email terlalu besar');
    const [name, domain] = message.to.toLowerCase().split('@');
    if (domain !== env.MAIL_DOMAIN.toLowerCase() || !NAME_RE.test(name)) {
      return message.setReject('Alamat tidak valid');
    }
    const mail = await PostalMime.parse(await new Response(message.raw).arrayBuffer());
    const from = mail.from ? (mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address) : 'Tidak diketahui';
    await boxOf(env, name).add({
      id: crypto.randomUUID(),
      from,
      subject: mail.subject || '(tanpa subjek)',
      text: String(mail.text || '').slice(0, 200000),
      html: String(mail.html || '').slice(0, 500000),
      ts: Date.now(),
    });
  },
};
