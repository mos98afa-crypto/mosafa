'use strict';
/**
 * خادم إدارة المولدة — بدون أي مكتبات خارجية.
 * المتطلبات: Node.js 22.13 أو أحدث (يستخدم SQLite المدمج).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { openDb } = require('./db');

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'generator.db');
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOW_REGISTER = process.env.ALLOW_REGISTER !== '0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const RESET_MS = 60 * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const db = openDb(DB_PATH);

/* ------------------------------------------------------------------ */
/* أدوات مساعدة                                                        */
/* ------------------------------------------------------------------ */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const q = (sql, ...p) => db.prepare(sql).all(...p);
const q1 = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function str(v, { max = 200, required = false, name = 'الحقل' } = {}) {
  v = v == null ? '' : String(v).trim();
  if (required && !v) throw bad(`${name} مطلوب`);
  if (v.length > max) throw bad(`${name} طويل جداً`);
  return v;
}
function num(v, { name = 'القيمة', allowZero = true } = {}) {
  if (v === '' || v == null) throw bad(`${name} مطلوب`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} غير صالح`);
  if (n < 0 || (!allowZero && n === 0)) throw bad(`${name} يجب أن يكون أكبر من صفر`);
  if (n > 1e12) throw bad(`${name} كبير جداً`);
  return round2(n);
}
function dateStr(v, name = 'التاريخ') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return v;
  }
  throw bad(`${name} غير صالح`);
}
function periodStr(v) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''))) throw bad('الشهر غير صالح');
  return v;
}
function email(v) {
  v = str(v, { max: 254, required: true, name: 'البريد الإلكتروني' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('البريد الإلكتروني غير صالح');
  return v;
}
function password(v) {
  v = String(v || '');
  if (v.length < 8) throw bad('كلمة المرور يجب ألا تقل عن 8 أحرف');
  if (v.length > 200) throw bad('كلمة المرور طويلة جداً');
  return v;
}
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ */
/* كلمات المرور والجلسات                                               */
/* ------------------------------------------------------------------ */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
const DUMMY_HASH_PROMISE = hashPassword('dummy-password-for-timing');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isSecure(req) {
  return req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') || process.env.COOKIE_SECURE === '1';
}
function setSessionCookie(req, res, token, maxAgeSec) {
  const parts = [`sid=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSec}`];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, Date.now() + SESSION_MS);
  setSessionCookie(req, res, token, SESSION_MS / 1000);
}
function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = q1(
    `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token)
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, _token: token };
}

/* تحديد المحاولات لمنع التخمين */
const attempts = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n++;
  attempts.set(key, rec);
  if (rec.n > max) throw new HttpError(429, 'محاولات كثيرة. حاول مرة أخرى بعد قليل');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (now > v.reset) attempts.delete(k);
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run('DELETE FROM reset_tokens WHERE expires_at < ?', now);
}, 10 * 60 * 1000).unref();
const clientIp = (req) =>
  (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

/* إرسال رابط استعادة كلمة المرور */
async function sendResetEmail(to, link) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (key && from) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [to], subject: 'استعادة كلمة المرور',
          html: `<div dir="rtl" style="font-family:sans-serif"><p>وصلنا طلب لتغيير كلمة المرور.</p><p><a href="${link}">اضغط هنا لتعيين كلمة مرور جديدة</a></p><p>الرابط صالح لمدة ساعة. إذا لم تطلب ذلك فتجاهل الرسالة.</p></div>`
        })
      });
      if (!r.ok) console.error('فشل إرسال البريد:', r.status, await r.text());
      return;
    } catch (e) {
      console.error('فشل إرسال البريد:', e.message);
    }
  }
  // بدون إعداد بريد: يُطبع الرابط في سجل الخادم (مناسب للتطوير أو للمسؤول)
  console.log(`RESET_LINK ${to} ${link}`);
}

/* ------------------------------------------------------------------ */
/* المسارات                                                            */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, handler, { auth = true } = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
}
const ownedRow = (table, id, uid) => {
  const row = q1(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, Number(id), uid);
  if (!row) throw new HttpError(404, 'العنصر غير موجود');
  return row;
};
const mustOwnSubscriber = (id, uid) => {
  const n = Number(id);
  if (!Number.isInteger(n)) throw bad('المشترك غير صالح');
  const row = q1('SELECT id, monthly_fee FROM subscribers WHERE id = ? AND user_id = ?', n, uid);
  if (!row) throw bad('المشترك غير موجود');
  return row;
};

/* ---------- المصادقة ---------- */
route('POST', '/api/auth/register', async ({ req, res, body }) => {
  if (!ALLOW_REGISTER) throw new HttpError(403, 'إنشاء الحسابات الجديدة متوقف');
  limit('reg:' + clientIp(req), 10, 3600 * 1000);
  const name = str(body.name, { max: 80, required: true, name: 'الاسم' });
  const mail = email(body.email);
  const pw = password(body.password);
  if (q1('SELECT id FROM users WHERE email = ?', mail)) throw new HttpError(409, 'هذا البريد مسجل مسبقاً');
  const hash = await hashPassword(pw);
  const r = run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?,?,?,?)', mail, name, hash, nowIso());
  const id = Number(r.lastInsertRowid);
  run('INSERT INTO settings (user_id, generator_name) VALUES (?, ?)', id, '');
  createSession(req, res, id);
  return { user: { id, email: mail, name } };
}, { auth: false });

route('POST', '/api/auth/login', async ({ req, res, body }) => {
  const mail = String(body.email || '').trim().toLowerCase();
  limit(`login:${clientIp(req)}:${mail}`, 8, 10 * 60 * 1000);
  const pw = String(body.password || '');
  const user = q1('SELECT * FROM users WHERE email = ?', mail);
  const ok = await verifyPassword(pw, user ? user.password_hash : await DUMMY_HASH_PROMISE);
  if (!user || !ok) throw new HttpError(401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
  createSession(req, res, user.id);
  return { user: { id: user.id, email: user.email, name: user.name } };
}, { auth: false });

route('POST', '/api/auth/logout', ({ req, res, user }) => {
  if (user) run('DELETE FROM sessions WHERE token_hash = ?', sha256(user._token));
  setSessionCookie(req, res, '', 0);
  return { ok: true };
}, { auth: false });

route('GET', '/api/auth/me', ({ user }) => {
  if (!user) throw new HttpError(401, 'غير مسجل الدخول');
  return { user: { id: user.id, email: user.email, name: user.name } };
}, { auth: false });

route('POST', '/api/auth/forgot', async ({ req, body }) => {
  limit('forgot:' + clientIp(req), 5, 3600 * 1000);
  const mail = String(body.email || '').trim().toLowerCase();
  const user = q1('SELECT id FROM users WHERE email = ?', mail);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    run('DELETE FROM reset_tokens WHERE user_id = ?', user.id);
    run('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), user.id, Date.now() + RESET_MS);
    await sendResetEmail(mail, `${APP_URL}/reset?token=${token}`);
  }
  // نفس الرد دائماً حتى لا يُكشف وجود الحساب
  return { ok: true };
}, { auth: false });

route('POST', '/api/auth/reset', async ({ body }) => {
  const token = String(body.token || '');
  const pw = password(body.password);
  const rec = /^[0-9a-f]{64}$/.test(token) ? q1('SELECT * FROM reset_tokens WHERE token_hash = ?', sha256(token)) : null;
  if (!rec || rec.expires_at < Date.now()) throw bad('رابط الاستعادة غير صالح أو منتهي');
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), rec.user_id);
  run('DELETE FROM reset_tokens WHERE user_id = ?', rec.user_id);
  run('DELETE FROM sessions WHERE user_id = ?', rec.user_id);
  return { ok: true };
}, { auth: false });

route('POST', '/api/auth/password', async ({ user, body }) => {
  const row = q1('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!(await verifyPassword(String(body.current || ''), row.password_hash))) throw bad('كلمة المرور الحالية غير صحيحة');
  const pw = password(body.next);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw), user.id);
  run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, sha256(user._token));
  return { ok: true };
});

route('PUT', '/api/auth/profile', ({ user, body }) => {
  const name = str(body.name, { max: 80, required: true, name: 'الاسم' });
  run('UPDATE users SET name = ? WHERE id = ?', name, user.id);
  return { user: { id: user.id, email: user.email, name } };
});

/* ---------- الإعدادات ---------- */
route('GET', '/api/settings', ({ user }) => {
  let s = q1('SELECT * FROM settings WHERE user_id = ?', user.id);
  if (!s) { run('INSERT INTO settings (user_id) VALUES (?)', user.id); s = q1('SELECT * FROM settings WHERE user_id = ?', user.id); }
  return { settings: s };
});
route('PUT', '/api/settings', ({ user, body }) => {
  const v = {
    generator_name: str(body.generator_name, { max: 100, name: 'اسم المولدة' }),
    phone: str(body.phone, { max: 40, name: 'الهاتف' }),
    address: str(body.address, { max: 200, name: 'العنوان' }),
    currency: str(body.currency, { max: 12, required: true, name: 'العملة' }),
    price_per_amp: num(body.price_per_amp, { name: 'سعر الأمبير' }),
    notes: str(body.notes, { max: 1000, name: 'الملاحظات' })
  };
  run(
    `INSERT INTO settings (user_id, generator_name, phone, address, currency, price_per_amp, notes)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET generator_name=excluded.generator_name, phone=excluded.phone,
       address=excluded.address, currency=excluded.currency, price_per_amp=excluded.price_per_amp, notes=excluded.notes`,
    user.id, v.generator_name, v.phone, v.address, v.currency, v.price_per_amp, v.notes
  );
  return { settings: q1('SELECT * FROM settings WHERE user_id = ?', user.id) };
});

/* ---------- المشتركون ---------- */
const BALANCES_SQL = `
  SELECT s.*,
    COALESCE((SELECT SUM(x.amount) FROM subscriptions x WHERE x.subscriber_id = s.id), 0) AS billed,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.subscriber_id = s.id), 0) AS paid
  FROM subscribers s WHERE s.user_id = ?`;
const withBalance = (r) => ({ ...r, billed: round2(r.billed), paid: round2(r.paid), balance: round2(r.billed - r.paid) });

function subscriberInput(body, uid) {
  const settings = q1('SELECT price_per_amp FROM settings WHERE user_id = ?', uid) || { price_per_amp: 0 };
  const amps = body.amps === '' || body.amps == null ? 0 : num(body.amps, { name: 'الأمبيرات' });
  const fee = body.monthly_fee === '' || body.monthly_fee == null
    ? round2(amps * settings.price_per_amp)
    : num(body.monthly_fee, { name: 'الاشتراك الشهري' });
  const status = body.status === 'inactive' ? 'inactive' : 'active';
  return {
    name: str(body.name, { max: 100, required: true, name: 'اسم المشترك' }),
    phone: str(body.phone, { max: 40, name: 'الهاتف' }),
    address: str(body.address, { max: 200, name: 'العنوان' }),
    amps, fee, status,
    notes: str(body.notes, { max: 1000, name: 'الملاحظات' })
  };
}

route('GET', '/api/subscribers', ({ user }) => ({
  subscribers: q(BALANCES_SQL + ' ORDER BY s.name COLLATE NOCASE', user.id).map(withBalance)
}));
route('POST', '/api/subscribers', ({ user, body }) => {
  const v = subscriberInput(body, user.id);
  const r = run(
    `INSERT INTO subscribers (user_id, name, phone, address, amps, monthly_fee, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    user.id, v.name, v.phone, v.address, v.amps, v.fee, v.status, v.notes, nowIso()
  );
  return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/subscribers/:id', ({ user, params }) => {
  const row = q1(BALANCES_SQL + ' AND s.id = ?', user.id, Number(params.id));
  if (!row) throw new HttpError(404, 'المشترك غير موجود');
  return {
    subscriber: withBalance(row),
    subscriptions: q('SELECT * FROM subscriptions WHERE subscriber_id = ? AND user_id = ? ORDER BY period DESC', row.id, user.id),
    payments: q('SELECT * FROM payments WHERE subscriber_id = ? AND user_id = ? ORDER BY paid_at DESC, id DESC', row.id, user.id)
  };
});
route('PUT', '/api/subscribers/:id', ({ user, params, body }) => {
  ownedRow('subscribers', params.id, user.id);
  const v = subscriberInput(body, user.id);
  run(
    `UPDATE subscribers SET name=?, phone=?, address=?, amps=?, monthly_fee=?, status=?, notes=? WHERE id=? AND user_id=?`,
    v.name, v.phone, v.address, v.amps, v.fee, v.status, v.notes, Number(params.id), user.id
  );
  return { ok: true };
});
route('DELETE', '/api/subscribers/:id', ({ user, params }) => {
  ownedRow('subscribers', params.id, user.id);
  run('DELETE FROM subscribers WHERE id = ? AND user_id = ?', Number(params.id), user.id);
  return { ok: true };
});

/* ---------- الاشتراكات الشهرية ---------- */
route('GET', '/api/subscriptions', ({ user, query }) => {
  const period = periodStr(query.get('period'));
  return {
    subscriptions: q(
      `SELECT x.*, s.name AS subscriber_name FROM subscriptions x JOIN subscribers s ON s.id = x.subscriber_id
       WHERE x.user_id = ? AND x.period = ? ORDER BY s.name COLLATE NOCASE`, user.id, period)
  };
});
route('POST', '/api/subscriptions/generate', ({ user, body }) => {
  const period = periodStr(body.period);
  const subs = q(`SELECT id, monthly_fee FROM subscribers WHERE user_id = ? AND status = 'active' AND monthly_fee > 0`, user.id);
  let created = 0;
  db.exec('BEGIN');
  try {
    for (const s of subs) {
      const r = run('INSERT OR IGNORE INTO subscriptions (user_id, subscriber_id, period, amount, created_at) VALUES (?,?,?,?,?)',
        user.id, s.id, period, s.monthly_fee, nowIso());
      created += Number(r.changes);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { created, skipped: subs.length - created };
});
route('POST', '/api/subscriptions', ({ user, body }) => {
  const sub = mustOwnSubscriber(body.subscriber_id, user.id);
  const period = periodStr(body.period);
  const amount = body.amount === '' || body.amount == null ? sub.monthly_fee : num(body.amount, { name: 'المبلغ' });
  if (q1('SELECT id FROM subscriptions WHERE subscriber_id = ? AND period = ?', sub.id, period))
    throw new HttpError(409, 'هذا المشترك لديه اشتراك مسجل لهذا الشهر');
  const r = run('INSERT INTO subscriptions (user_id, subscriber_id, period, amount, created_at) VALUES (?,?,?,?,?)',
    user.id, sub.id, period, amount, nowIso());
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/subscriptions/:id', ({ user, params, body }) => {
  ownedRow('subscriptions', params.id, user.id);
  run('UPDATE subscriptions SET amount = ? WHERE id = ? AND user_id = ?', num(body.amount, { name: 'المبلغ' }), Number(params.id), user.id);
  return { ok: true };
});
route('DELETE', '/api/subscriptions/:id', ({ user, params }) => {
  ownedRow('subscriptions', params.id, user.id);
  run('DELETE FROM subscriptions WHERE id = ? AND user_id = ?', Number(params.id), user.id);
  return { ok: true };
});

/* ---------- الدفعات ---------- */
const METHODS = ['cash', 'transfer', 'other'];
function paymentInput(body, uid) {
  const sub = mustOwnSubscriber(body.subscriber_id, uid);
  return {
    sub,
    amount: num(body.amount, { name: 'المبلغ', allowZero: false }),
    paid_at: dateStr(body.paid_at, 'تاريخ الدفعة'),
    method: METHODS.includes(body.method) ? body.method : 'cash',
    note: str(body.note, { max: 500, name: 'الملاحظة' })
  };
}
route('GET', '/api/payments', ({ user, query }) => {
  const where = ['p.user_id = ?']; const args = [user.id];
  if (query.get('subscriber_id')) { where.push('p.subscriber_id = ?'); args.push(Number(query.get('subscriber_id'))); }
  if (query.get('from')) { where.push('p.paid_at >= ?'); args.push(dateStr(query.get('from'), 'من تاريخ')); }
  if (query.get('to')) { where.push('p.paid_at <= ?'); args.push(dateStr(query.get('to'), 'إلى تاريخ')); }
  const rows = q(
    `SELECT p.*, s.name AS subscriber_name FROM payments p JOIN subscribers s ON s.id = p.subscriber_id
     WHERE ${where.join(' AND ')} ORDER BY p.paid_at DESC, p.id DESC LIMIT 1000`, ...args);
  return { payments: rows, total: round2(rows.reduce((a, r) => a + r.amount, 0)) };
});
route('POST', '/api/payments', ({ user, body }) => {
  const v = paymentInput(body, user.id);
  const r = run('INSERT INTO payments (user_id, subscriber_id, amount, paid_at, method, note, created_at) VALUES (?,?,?,?,?,?,?)',
    user.id, v.sub.id, v.amount, v.paid_at, v.method, v.note, nowIso());
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/payments/:id', ({ user, params, body }) => {
  ownedRow('payments', params.id, user.id);
  const v = paymentInput(body, user.id);
  run('UPDATE payments SET subscriber_id=?, amount=?, paid_at=?, method=?, note=? WHERE id=? AND user_id=?',
    v.sub.id, v.amount, v.paid_at, v.method, v.note, Number(params.id), user.id);
  return { ok: true };
});
route('DELETE', '/api/payments/:id', ({ user, params }) => {
  ownedRow('payments', params.id, user.id);
  run('DELETE FROM payments WHERE id = ? AND user_id = ?', Number(params.id), user.id);
  return { ok: true };
});

/* ---------- المصاريف ---------- */
function expenseInput(body) {
  return {
    category: str(body.category, { max: 60, required: true, name: 'نوع المصروف' }),
    amount: num(body.amount, { name: 'المبلغ', allowZero: false }),
    spent_at: dateStr(body.spent_at, 'تاريخ المصروف'),
    note: str(body.note, { max: 500, name: 'الملاحظة' })
  };
}
route('GET', '/api/expenses', ({ user, query }) => {
  const where = ['user_id = ?']; const args = [user.id];
  if (query.get('from')) { where.push('spent_at >= ?'); args.push(dateStr(query.get('from'), 'من تاريخ')); }
  if (query.get('to')) { where.push('spent_at <= ?'); args.push(dateStr(query.get('to'), 'إلى تاريخ')); }
  const rows = q(`SELECT * FROM expenses WHERE ${where.join(' AND ')} ORDER BY spent_at DESC, id DESC LIMIT 1000`, ...args);
  return { expenses: rows, total: round2(rows.reduce((a, r) => a + r.amount, 0)) };
});
route('POST', '/api/expenses', ({ user, body }) => {
  const v = expenseInput(body);
  const r = run('INSERT INTO expenses (user_id, category, amount, spent_at, note, created_at) VALUES (?,?,?,?,?,?)',
    user.id, v.category, v.amount, v.spent_at, v.note, nowIso());
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/expenses/:id', ({ user, params, body }) => {
  ownedRow('expenses', params.id, user.id);
  const v = expenseInput(body);
  run('UPDATE expenses SET category=?, amount=?, spent_at=?, note=? WHERE id=? AND user_id=?',
    v.category, v.amount, v.spent_at, v.note, Number(params.id), user.id);
  return { ok: true };
});
route('DELETE', '/api/expenses/:id', ({ user, params }) => {
  ownedRow('expenses', params.id, user.id);
  run('DELETE FROM expenses WHERE id = ? AND user_id = ?', Number(params.id), user.id);
  return { ok: true };
});

/* ---------- الديون ---------- */
route('GET', '/api/debts', ({ user }) => {
  const rows = q(BALANCES_SQL, user.id).map(withBalance).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
  return { debts: rows, total: round2(rows.reduce((a, r) => a + r.balance, 0)) };
});

/* ---------- لوحة التحكم ---------- */
route('GET', '/api/dashboard', ({ user }) => {
  const uid = user.id;
  const subs = q(BALANCES_SQL, uid).map(withBalance);
  const sum = (sql, ...a) => round2(q1(sql, ...a).v || 0);
  const revenue = sum('SELECT SUM(amount) v FROM subscriptions WHERE user_id = ?', uid);
  const received = sum('SELECT SUM(amount) v FROM payments WHERE user_id = ?', uid);
  const expenses = sum('SELECT SUM(amount) v FROM expenses WHERE user_id = ?', uid);
  const debts = round2(subs.reduce((a, s) => a + Math.max(s.balance, 0), 0));
  const month = todayLocal().slice(0, 7);
  const monthReceived = sum('SELECT SUM(amount) v FROM payments WHERE user_id = ? AND substr(paid_at,1,7) = ?', uid, month);
  const monthExpenses = sum('SELECT SUM(amount) v FROM expenses WHERE user_id = ? AND substr(spent_at,1,7) = ?', uid, month);
  const recent = q(
    `SELECT * FROM (
       SELECT 'payment' AS type, p.id, p.amount, p.paid_at AS date, s.name AS label, p.created_at
         FROM payments p JOIN subscribers s ON s.id = p.subscriber_id WHERE p.user_id = ?
       UNION ALL
       SELECT 'expense', e.id, e.amount, e.spent_at, e.category, e.created_at FROM expenses e WHERE e.user_id = ?
       UNION ALL
       SELECT 'subscription', x.id, x.amount, x.period, s.name, x.created_at
         FROM subscriptions x JOIN subscribers s ON s.id = x.subscriber_id WHERE x.user_id = ?
     ) ORDER BY created_at DESC, id DESC LIMIT 10`, uid, uid, uid);
  return {
    stats: {
      subscribers_total: subs.length,
      subscribers_active: subs.filter((s) => s.status === 'active').length,
      revenue, received, debts, expenses,
      profit: round2(received - expenses),
      collection_rate: revenue > 0 ? Math.min(1, received / revenue) : 0,
      month, month_received: monthReceived, month_expenses: monthExpenses
    },
    top_debtors: subs.filter((s) => s.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5)
      .map((s) => ({ id: s.id, name: s.name, phone: s.phone, balance: s.balance })),
    recent
  };
});

/* ---------- التقارير ---------- */
route('GET', '/api/reports', ({ user, query }) => {
  const uid = user.id;
  const year = String(query.get('year') || todayLocal().slice(0, 4));
  if (!/^\d{4}$/.test(year)) throw bad('السنة غير صالحة');
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, revenue: 0, received: 0, expenses: 0 }));
  const put = (rows, field) => rows.forEach((r) => { const m = months.find((x) => x.month === r.m); if (m) m[field] = round2(r.v); });
  put(q('SELECT period AS m, SUM(amount) v FROM subscriptions WHERE user_id = ? AND substr(period,1,4) = ? GROUP BY period', uid, year), 'revenue');
  put(q('SELECT substr(paid_at,1,7) AS m, SUM(amount) v FROM payments WHERE user_id = ? AND substr(paid_at,1,4) = ? GROUP BY m', uid, year), 'received');
  put(q('SELECT substr(spent_at,1,7) AS m, SUM(amount) v FROM expenses WHERE user_id = ? AND substr(spent_at,1,4) = ? GROUP BY m', uid, year), 'expenses');
  months.forEach((m) => { m.profit = round2(m.received - m.expenses); });
  const totals = months.reduce((t, m) => ({
    revenue: round2(t.revenue + m.revenue), received: round2(t.received + m.received),
    expenses: round2(t.expenses + m.expenses), profit: round2(t.profit + m.profit)
  }), { revenue: 0, received: 0, expenses: 0, profit: 0 });
  const byCategory = q(
    'SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE user_id = ? AND substr(spent_at,1,4) = ? GROUP BY category ORDER BY total DESC',
    uid, year).map((r) => ({ ...r, total: round2(r.total) }));
  const debtors = q(BALANCES_SQL, uid).map(withBalance).filter((s) => s.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 10)
    .map((s) => ({ id: s.id, name: s.name, phone: s.phone, billed: s.billed, paid: s.paid, balance: s.balance }));
  const years = q(
    `SELECT DISTINCT y FROM (SELECT substr(paid_at,1,4) y FROM payments WHERE user_id = ?
      UNION SELECT substr(spent_at,1,4) FROM expenses WHERE user_id = ?
      UNION SELECT substr(period,1,4) FROM subscriptions WHERE user_id = ?) ORDER BY y DESC`, uid, uid, uid).map((r) => r.y);
  if (!years.includes(todayLocal().slice(0, 4))) years.unshift(todayLocal().slice(0, 4));
  return { year, years, months, totals, expenses_by_category: byCategory, top_debtors: debtors };
});

/* ------------------------------------------------------------------ */
/* معالجة الطلبات                                                      */
/* ------------------------------------------------------------------ */
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...headers
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, 'حجم الطلب كبير جداً')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch { reject(bad('صيغة الطلب غير صالحة')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) throw new HttpError(404, 'المسار غير موجود');
  // حماية CSRF: الطلبات المعدِّلة يجب أن تحمل ترويسة لا تستطيع المواقع الأخرى إرسالها
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'طلب مرفوض');
  const user = currentUser(req);
  if (r.auth && !user) throw new HttpError(401, 'يجب تسجيل الدخول');
  const m = r.re.exec(url.pathname);
  const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const body = req.method === 'GET' ? {} : await readBody(req);
  const result = await r.handler({ req, res, user, params, body, query: url.searchParams });
  send(res, 200, result);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};
function serveFile(res, file) {
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch { send(res, 404, 'الصفحة غير موجودة'); }
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }

function handlePage(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'غير مسموح');
  const p = url.pathname;
  if (p === '/' || p === '/app') {
    if (!currentUser(req)) return redirect(res, '/login');
    return serveFile(res, path.join(PUBLIC_DIR, 'app.html'));
  }
  if (['/login', '/register', '/forgot', '/reset'].includes(p)) {
    if (p !== '/reset' && currentUser(req)) return redirect(res, '/');
    return serveFile(res, path.join(PUBLIC_DIR, 'login.html'));
  }
  if (p === '/favicon.svg' || p.startsWith('/assets/')) {
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'ممنوع');
    return serveFile(res, file);
  }
  return redirect(res, '/');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else handlePage(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'حدث خطأ غير متوقع في الخادم' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`الخادم يعمل على ${APP_URL}  (قاعدة البيانات: ${DB_PATH})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); });
}
