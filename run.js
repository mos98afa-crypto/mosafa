'use strict';
/**
 * اختبار شامل: يشغّل الخادم على قاعدة بيانات مؤقتة، ثم يعيد تشغيله للتأكد من بقاء البيانات.
 * التشغيل:  npm test
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-test-'));
const DB_PATH = path.join(tmp, 'test.db');
let server; let logs = '';

function start() {
  return new Promise((resolve, reject) => {
    logs = '';
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH, APP_URL: BASE },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', (d) => { logs += d; if (String(d).includes('الخادم يعمل')) resolve(); });
    server.stderr.on('data', (d) => { if (!String(d).includes('ExperimentalWarning') && !String(d).includes('trace-warnings')) process.stderr.write(d); });
    server.on('error', reject);
  });
}
const stop = () => new Promise((r) => { server.once('exit', r); server.kill('SIGTERM'); });

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, { raw = false, headers = {} } = {}) {
    const res = await fetch(BASE + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b || {}); }
  put(u, b) { return this.req('PUT', u, b || {}); }
  del(u) { return this.req('DELETE', u); }
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; throw e; }
}

(async () => {
  await start();
  const A = new Client(); const B = new Client(); const anon = new Client();
  const pwA = 'كلمة-سر-قوية-1'; let subId; let sub2Id;

  console.log('\nالمصادقة');
  await test('الصفحة الرئيسية تحوّل غير المسجل إلى /login', async () => {
    const r = await anon.req('GET', '/', null, { raw: true });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/login');
  });
  await test('واجهة API ترفض غير المسجل', async () => {
    for (const u of ['/api/dashboard', '/api/subscribers', '/api/payments', '/api/expenses', '/api/reports', '/api/settings', '/api/debts']) {
      assert.equal((await anon.get(u)).status, 401, u);
    }
  });
  await test('رفض الطلبات المعدِّلة بدون ترويسة CSRF', async () => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
  });
  await test('التسجيل يرفض كلمة مرور قصيرة وبريداً غير صالح', async () => {
    assert.equal((await anon.post('/api/auth/register', { name: 'س', email: 'a@b.co', password: '123' })).status, 400);
    assert.equal((await anon.post('/api/auth/register', { name: 'س', email: 'xx', password: '12345678' })).status, 400);
  });
  await test('إنشاء حساب A وتسجيل الدخول تلقائياً', async () => {
    const r = await A.post('/api/auth/register', { name: 'أحمد', email: 'A@Example.com', password: pwA });
    assert.equal(r.status, 200); assert.equal(r.data.user.email, 'a@example.com');
    assert.equal((await A.get('/api/auth/me')).status, 200);
  });
  await test('رفض بريد مكرر', async () => {
    assert.equal((await anon.post('/api/auth/register', { name: 'x', email: 'a@example.com', password: pwA })).status, 409);
  });
  await test('كلمة مرور خاطئة تُرفض، والصحيحة تنجح', async () => {
    const C = new Client();
    assert.equal((await C.post('/api/auth/login', { email: 'a@example.com', password: 'wrong-wrong' })).status, 401);
    assert.equal((await C.post('/api/auth/login', { email: 'a@example.com', password: pwA })).status, 200);
    assert.equal((await C.get('/api/auth/me')).status, 200);
  });
  await test('/login يحوّل المسجل إلى لوحة التحكم', async () => {
    const r = await A.req('GET', '/login', null, { raw: true });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/');
    assert.equal((await A.req('GET', '/', null, { raw: true })).status, 200);
  });

  console.log('\nلوحة التحكم فارغة (بدون بيانات وهمية)');
  await test('كل الأرقام صفر لحساب جديد', async () => {
    const { data } = await A.get('/api/dashboard');
    assert.deepEqual([data.stats.subscribers_total, data.stats.received, data.stats.debts, data.stats.expenses, data.stats.revenue, data.stats.profit], [0, 0, 0, 0, 0, 0]);
    assert.equal(data.recent.length, 0);
  });

  console.log('\nالإعدادات والمشتركون');
  await test('حفظ إعدادات المولدة', async () => {
    const r = await A.put('/api/settings', { generator_name: 'مولدة الحي', phone: '0770', address: 'بغداد', currency: 'د.ع', price_per_amp: 10000, notes: '' });
    assert.equal(r.status, 200); assert.equal(r.data.settings.price_per_amp, 10000);
  });
  await test('إضافة مشترك: الاشتراك يُحسب من الأمبيرات × السعر', async () => {
    const r = await A.post('/api/subscribers', { name: 'علي', phone: '0771', address: 'شارع 1', amps: 5 });
    assert.equal(r.status, 200); subId = r.data.id;
    const d = (await A.get(`/api/subscribers/${subId}`)).data;
    assert.equal(d.subscriber.monthly_fee, 50000);
  });
  await test('إضافة مشترك ثانٍ باشتراك يدوي', async () => {
    const r = await A.post('/api/subscribers', { name: 'حسن', phone: '', address: '', amps: 3, monthly_fee: 25000 });
    sub2Id = r.data.id; assert.ok(sub2Id);
  });
  await test('تعديل مشترك', async () => {
    assert.equal((await A.put(`/api/subscribers/${subId}`, { name: 'علي الأول', phone: '0771', address: 'شارع 2', amps: 5, monthly_fee: 50000, status: 'active' })).status, 200);
    assert.equal((await A.get(`/api/subscribers/${subId}`)).data.subscriber.name, 'علي الأول');
  });
  await test('اسم مشترك فارغ يُرفض', async () => {
    assert.equal((await A.post('/api/subscribers', { name: '  ' })).status, 400);
  });

  console.log('\nالاشتراكات والدفعات والديون والمصاريف');
  await test('إصدار اشتراكات شهر لكل المشتركين النشطين (ولا يتكرر)', async () => {
    const r = await A.post('/api/subscriptions/generate', { period: '2026-09' });
    assert.equal(r.data.created, 2);
    const again = await A.post('/api/subscriptions/generate', { period: '2026-09' });
    assert.equal(again.data.created, 0);
    assert.equal((await A.get('/api/subscriptions?period=2026-09')).data.subscriptions.length, 2);
  });
  await test('الدين = الاشتراكات − الدفعات', async () => {
    const p = await A.post('/api/payments', { subscriber_id: subId, amount: 20000, paid_at: '2026-09-05', method: 'cash', note: '' });
    assert.equal(p.status, 200);
    const s = (await A.get(`/api/subscribers/${subId}`)).data.subscriber;
    assert.deepEqual([s.billed, s.paid, s.balance], [50000, 20000, 30000]);
    const debts = (await A.get('/api/debts')).data;
    assert.equal(debts.total, 55000);
  });
  await test('رفض دفعة بمبلغ صفر أو تاريخ غير صالح', async () => {
    assert.equal((await A.post('/api/payments', { subscriber_id: subId, amount: 0, paid_at: '2026-09-05' })).status, 400);
    assert.equal((await A.post('/api/payments', { subscriber_id: subId, amount: 5, paid_at: '2026-02-31' })).status, 400);
  });
  await test('إضافة مصروف', async () => {
    assert.equal((await A.post('/api/expenses', { category: 'وقود', amount: 15000, spent_at: '2026-09-06', note: '' })).status, 200);
  });
  await test('أرقام لوحة التحكم تطابق الحسابات', async () => {
    const { data } = await A.get('/api/dashboard');
    assert.deepEqual(
      [data.stats.subscribers_total, data.stats.revenue, data.stats.received, data.stats.debts, data.stats.expenses, data.stats.profit],
      [2, 75000, 20000, 55000, 15000, 5000]);
    assert.equal(data.recent.length, 4);
    assert.equal(data.top_debtors[0].name, 'علي الأول');
  });
  await test('تعديل الدفعة يحدّث اللوحة فوراً', async () => {
    const pid = (await A.get('/api/payments')).data.payments[0].id;
    await A.put(`/api/payments/${pid}`, { subscriber_id: subId, amount: 50000, paid_at: '2026-09-05', method: 'transfer', note: 'كاملة' });
    const { data } = await A.get('/api/dashboard');
    assert.deepEqual([data.stats.received, data.stats.debts, data.stats.profit], [50000, 25000, 35000]);
  });
  await test('التقرير الشهري صحيح', async () => {
    const { data } = await A.get('/api/reports?year=2026');
    const sep = data.months.find((m) => m.month === '2026-09');
    assert.deepEqual([sep.revenue, sep.received, sep.expenses, sep.profit], [75000, 50000, 15000, 35000]);
    assert.equal(data.expenses_by_category[0].category, 'وقود');
  });

  console.log('\nعزل بيانات المستخدمين');
  await test('إنشاء حساب B', async () => {
    const r = await B.post('/api/auth/register', { name: 'بسام', email: 'b@example.com', password: 'another-pass-2' });
    assert.equal(r.status, 200);
    const d = (await B.get('/api/dashboard')).data.stats;
    assert.equal(d.subscribers_total, 0); assert.equal(d.received, 0);
    assert.equal((await B.get('/api/subscribers')).data.subscribers.length, 0);
  });
  await test('B لا يستطيع قراءة أو تعديل أو حذف بيانات A', async () => {
    assert.equal((await B.get(`/api/subscribers/${subId}`)).status, 404);
    assert.equal((await B.put(`/api/subscribers/${subId}`, { name: 'اختراق' })).status, 404);
    assert.equal((await B.del(`/api/subscribers/${subId}`)).status, 404);
    const pid = (await A.get('/api/payments')).data.payments[0].id;
    assert.equal((await B.put(`/api/payments/${pid}`, { subscriber_id: subId, amount: 1, paid_at: '2026-09-01' })).status, 404);
    assert.equal((await B.del(`/api/payments/${pid}`)).status, 404);
    const eid = (await A.get('/api/expenses')).data.expenses[0].id;
    assert.equal((await B.del(`/api/expenses/${eid}`)).status, 404);
  });
  await test('B لا يستطيع تسجيل دفعة على مشترك A', async () => {
    assert.equal((await B.post('/api/payments', { subscriber_id: subId, amount: 100, paid_at: '2026-09-01' })).status, 400);
    assert.equal((await B.post('/api/subscriptions', { subscriber_id: subId, period: '2026-10' })).status, 400);
  });
  await test('بيانات A لم تتغير بعد محاولات B', async () => {
    const s = (await A.get(`/api/subscribers/${subId}`)).data.subscriber;
    assert.equal(s.name, 'علي الأول');
  });

  console.log('\nاستعادة كلمة المرور وتغييرها');
  await test('طلب الاستعادة يعطي نفس الرد لبريد غير موجود', async () => {
    assert.equal((await anon.post('/api/auth/forgot', { email: 'nobody@example.com' })).status, 200);
  });
  let resetToken;
  await test('رابط الاستعادة يظهر في السجل ويغيّر كلمة المرور', async () => {
    await anon.post('/api/auth/forgot', { email: 'a@example.com' });
    const m = /RESET_LINK a@example.com \S+token=([0-9a-f]{64})/.exec(logs);
    assert.ok(m, 'لم يظهر رابط الاستعادة'); resetToken = m[1];
    assert.equal((await anon.post('/api/auth/reset', { token: resetToken, password: 'short' })).status, 400);
    assert.equal((await anon.post('/api/auth/reset', { token: resetToken, password: 'new-password-99' })).status, 200);
    assert.equal((await anon.post('/api/auth/reset', { token: resetToken, password: 'new-password-98' })).status, 400, 'الرابط يُستخدم مرة واحدة');
  });
  await test('الجلسات القديمة تُلغى وكلمة المرور الجديدة تعمل', async () => {
    assert.equal((await A.get('/api/dashboard')).status, 401);
    assert.equal((await A.post('/api/auth/login', { email: 'a@example.com', password: pwA })).status, 401);
    assert.equal((await A.post('/api/auth/login', { email: 'a@example.com', password: 'new-password-99' })).status, 200);
  });
  await test('تغيير كلمة المرور من الإعدادات', async () => {
    assert.equal((await A.post('/api/auth/password', { current: 'خطأ', next: 'x'.repeat(10) })).status, 400);
    assert.equal((await A.post('/api/auth/password', { current: 'new-password-99', next: 'third-password-1' })).status, 200);
  });

  console.log('\nالبقاء بعد إعادة تشغيل الخادم (قاعدة بيانات دائمة)');
  await stop(); await start();
  await test('تسجيل الدخول من جديد يجد كل البيانات', async () => {
    const C = new Client();
    assert.equal((await C.post('/api/auth/login', { email: 'a@example.com', password: 'third-password-1' })).status, 200);
    const st = (await C.get('/api/dashboard')).data.stats;
    assert.deepEqual([st.subscribers_total, st.revenue, st.received, st.debts, st.expenses, st.profit], [2, 75000, 50000, 25000, 15000, 35000]);
    const s = (await C.get('/api/settings')).data.settings;
    assert.equal(s.generator_name, 'مولدة الحي');
    assert.equal((await C.get('/api/subscribers')).data.subscribers.length, 2);
  });
  await test('الجلسة القديمة (قبل الخروج) ما زالت صالحة بعد إعادة التشغيل', async () => {
    assert.equal((await A.get('/api/auth/me')).status, 200);
  });

  console.log('\nالحذف وتسجيل الخروج');
  await test('حذف مشترك يحذف دفعاته واشتراكاته ويحدّث الأرقام', async () => {
    assert.equal((await A.del(`/api/subscribers/${subId}`)).status, 200);
    const st = (await A.get('/api/dashboard')).data.stats;
    assert.deepEqual([st.subscribers_total, st.revenue, st.received, st.debts], [1, 25000, 0, 25000]);
  });
  await test('حذف مصروف', async () => {
    const eid = (await A.get('/api/expenses')).data.expenses[0].id;
    assert.equal((await A.del(`/api/expenses/${eid}`)).status, 200);
    assert.equal((await A.get('/api/dashboard')).data.stats.expenses, 0);
  });
  await test('تسجيل الخروج يمنع الوصول', async () => {
    assert.equal((await A.post('/api/auth/logout')).status, 200);
    assert.equal((await A.get('/api/dashboard')).status, 401);
    const r = await A.req('GET', '/', null, { raw: true });
    assert.equal(r.status, 302);
  });
  await test('حساب B ما زال سليماً وفارغاً', async () => {
    assert.equal((await B.get('/api/subscribers')).data.subscribers.length, 0);
  });

  await stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nنجح ${passed} اختباراً ✔`);
})().catch(async (e) => {
  console.error('\nفشل الاختبار:', e.message);
  try { await stop(); } catch {}
  process.exit(1);
});
