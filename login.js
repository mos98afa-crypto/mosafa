(() => {
  'use strict';
  const root = document.getElementById('authRoot');
  const path = location.pathname;

  // زخرفة لونية فقط (بدون أي أرقام)
  const wave = document.querySelector('.wave');
  if (wave) wave.innerHTML = Array.from({ length: 28 }, (_, i) => `<i style="height:${18 + Math.round(Math.abs(Math.sin(i / 3.2)) * 72)}%"></i>`).join('');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حدث خطأ، حاول مرة أخرى');
    return data;
  }

  function field(id, label, type, attrs = '') {
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${attrs} required></div>`;
  }
  const errBox = '<p class="form-error" role="alert" hidden></p>';

  function bind(form, handler, btnLabel) {
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('.form-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true; btn.disabled = true; btn.textContent = 'جارٍ المعالجة...';
      try { await handler(Object.fromEntries(new FormData(form))); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = btnLabel; }
    });
  }

  function tabs(active) {
    return `<div class="tabs"><a href="/login" class="${active === 'login' ? 'active' : ''}">تسجيل الدخول</a><a href="/register" class="${active === 'register' ? 'active' : ''}">حساب جديد</a></div>`;
  }

  if (path === '/register') {
    document.title = 'حساب جديد — مولّدتي';
    root.innerHTML = `<div class="auth-card">${tabs('register')}
      <h2>أنشئ حسابك</h2><p class="lead">لكل حساب بياناته الخاصة ولا يراها أحد غيرك.</p>
      <form>${field('name', 'الاسم', 'text', 'autocomplete="name" maxlength="80"')}
        ${field('email', 'البريد الإلكتروني', 'email', 'autocomplete="email" dir="ltr" style="text-align:right"')}
        ${field('password', 'كلمة المرور', 'password', 'autocomplete="new-password" minlength="8"')}
        <small class="muted">8 أحرف على الأقل.</small>${errBox}
        <button class="btn accent block" type="submit">إنشاء الحساب</button></form></div>`;
    bind(root.querySelector('form'), async (d) => { await post('/api/auth/register', d); location.href = '/'; }, 'إنشاء الحساب');
  } else if (path === '/forgot') {
    document.title = 'نسيت كلمة المرور — مولّدتي';
    root.innerHTML = `<div class="auth-card"><h2>نسيت كلمة المرور؟</h2>
      <p class="lead">اكتب بريدك الإلكتروني وسنرسل لك رابطاً لتعيين كلمة مرور جديدة.</p>
      <form>${field('email', 'البريد الإلكتروني', 'email', 'autocomplete="email" dir="ltr" style="text-align:right"')}${errBox}
        <button class="btn accent block" type="submit">إرسال رابط الاستعادة</button>
        <div class="auth-links"><a href="/login">العودة لتسجيل الدخول</a></div></form></div>`;
    bind(root.querySelector('form'), async (d) => {
      await post('/api/auth/forgot', d);
      root.querySelector('.auth-card').innerHTML = `<h2>تحقق من بريدك</h2>
        <p class="notice" style="margin-top:14px">إذا كان البريد مسجلاً لدينا فقد أرسلنا إليه رابط الاستعادة. الرابط صالح لمدة ساعة.</p>
        <p class="auth-links" style="margin-top:18px"><a href="/login">العودة لتسجيل الدخول</a></p>`;
    }, 'إرسال رابط الاستعادة');
  } else if (path === '/reset') {
    document.title = 'كلمة مرور جديدة — مولّدتي';
    const token = new URLSearchParams(location.search).get('token') || '';
    root.innerHTML = `<div class="auth-card"><h2>كلمة مرور جديدة</h2><p class="lead">اختر كلمة مرور لا تقل عن 8 أحرف.</p>
      <form>${field('password', 'كلمة المرور الجديدة', 'password', 'autocomplete="new-password" minlength="8"')}${errBox}
        <button class="btn accent block" type="submit">حفظ كلمة المرور</button></form></div>`;
    bind(root.querySelector('form'), async (d) => {
      await post('/api/auth/reset', { token, password: d.password });
      root.querySelector('.auth-card').innerHTML = `<h2>تم تغيير كلمة المرور</h2>
        <p class="notice" style="margin:14px 0 18px">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p>
        <a class="btn accent block" href="/login">تسجيل الدخول</a>`;
    }, 'حفظ كلمة المرور');
  } else {
    root.innerHTML = `<div class="auth-card">${tabs('login')}
      <h2>أهلاً بعودتك</h2><p class="lead">سجّل الدخول لمتابعة مشتركيك وحساباتك.</p>
      <form>${field('email', 'البريد الإلكتروني', 'email', 'autocomplete="email" dir="ltr" style="text-align:right"')}
        ${field('password', 'كلمة المرور', 'password', 'autocomplete="current-password"')}${errBox}
        <button class="btn accent block" type="submit">دخول</button>
        <div class="auth-links"><a href="/forgot">نسيت كلمة المرور؟</a></div></form></div>`;
    bind(root.querySelector('form'), async (d) => { await post('/api/auth/login', d); location.href = '/'; }, 'دخول');
  }
})();
