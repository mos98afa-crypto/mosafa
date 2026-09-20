(() => {
  'use strict';

  /* ------------------------------------------------------------ */
  /* أدوات                                                         */
  /* ------------------------------------------------------------ */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');
  const state = { user: null, settings: { currency: 'د.ع', price_per_amp: 0, generator_name: '' } };
  const cache = {};

  const I = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.2.7 3.5 2.7 3.5 5.6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>',
    alert: '<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    receipt: '<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8v-17Z"/><path d="M9 8h6M9 12h6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    back: '<path d="M9 5l7 7-7 7"/>',
    print: '<path d="M7 9V3.5h10V9M7 17H4.5v-8h15v8H17M7 14h10v6.5H7V14Z"/>'
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">${I[n]}</svg>`;

  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const cur = () => esc(state.settings.currency || '');
  const money = (n) => `<span class="num">${fmt(n)}</span> ${cur()}`;
  const moneySigned = (sign, n) => `<span class="num">${sign}${fmt(n)}</span> ${cur()}`;
  const moneyOrDash = (n) => (Number(n) ? money(n) : '<span class="muted">—</span>');
  const numTxt = (t) => `<span class="num">${esc(t)}</span>`;
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const thisMonth = () => today().slice(0, 7);
  const METHODS = { cash: 'نقداً', transfer: 'تحويل', other: 'أخرى' };
  const OPT_METHODS = Object.entries(METHODS).map(([v, l]) => ({ v, l }));

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { location.href = '/login'; throw new Error('انتهت الجلسة'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حدث خطأ، حاول مرة أخرى');
    return data;
  }

  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'err' ? 'err' : '');
    t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  /* ------------------------------------------------------------ */
  /* النوافذ والنماذج                                              */
  /* ------------------------------------------------------------ */
  function openModal(inner) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(ov);
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); prev && prev.focus && prev.focus(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    $$('[data-close]', ov).forEach((b) => b.addEventListener('click', close));
    const first = $('input:not([type=hidden]),select,textarea', ov) || $('button', ov);
    first && first.focus();
    return { el: ov, close };
  }

  function fieldHtml(f, val) {
    const v = val ?? f.value ?? '';
    const id = 'f_' + f.name;
    const req = f.required ? 'required' : '';
    let ctl;
    if (f.type === 'select') {
      ctl = `<select id="${id}" name="${f.name}" ${req}>${f.options.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      ctl = `<textarea id="${id}" name="${f.name}" maxlength="${f.max || 1000}" ${req}>${esc(v)}</textarea>`;
    } else {
      const extra = f.type === 'number' ? 'step="any" min="0" inputmode="decimal"' : '';
      ctl = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${extra} ${f.list ? `list="${id}_l"` : ''} ${f.max ? `maxlength="${f.max}"` : ''} ${req} autocomplete="off">` +
        (f.list ? `<datalist id="${id}_l">${f.list.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : '');
    }
    return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${ctl}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
  }

  function formModal({ title, fields, values = {}, submitLabel = 'حفظ', onSubmit, onInput }) {
    const { el, close } = openModal(`<form><h2>${esc(title)}</h2>
      <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="btn accent" type="submit">${esc(submitLabel)}</button><button class="btn ghost" type="button" data-close>إلغاء</button></div></form>`);
    const form = $('form', el); const err = $('.form-error', el);
    if (onInput) form.addEventListener('input', (e) => onInput(form, e));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      err.hidden = true; btn.disabled = true;
      try { await onSubmit(Object.fromEntries(new FormData(form))); close(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
    return { form, close };
  }

  function confirmBox(message, label = 'حذف') {
    return new Promise((resolve) => {
      const { el, close } = openModal(`<h2>تأكيد</h2><p class="msg">${esc(message)}</p>
        <div class="modal-actions"><button class="btn danger" data-ok type="button">${esc(label)}</button><button class="btn ghost" type="button" data-close>إلغاء</button></div>`);
      $('[data-ok]', el).addEventListener('click', () => { close(); resolve(true); });
      const ov = el; const obs = new MutationObserver(() => { if (!document.body.contains(ov)) { obs.disconnect(); resolve(false); } });
      obs.observe(document.body, { childList: true });
    });
  }

  async function doAction(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await render(); }
    catch (e) { toast(e.message, 'err'); }
  }

  /* ------------------------------------------------------------ */
  /* نماذج الكيانات                                                */
  /* ------------------------------------------------------------ */
  async function subscriberOptions({ withBalance = false, activeOnly = false } = {}) {
    const { subscribers } = await api('/subscribers');
    cache.subs = Object.fromEntries(subscribers.map((s) => [s.id, s]));
    return subscribers.filter((s) => !activeOnly || s.status === 'active')
      .map((s) => ({ v: s.id, l: withBalance && s.balance > 0 ? `${s.name} (عليه ${fmt(s.balance)})` : s.name }));
  }

  function subscriberForm(sub) {
    const price = Number(state.settings.price_per_amp) || 0;
    const editing = !!sub;
    const { form } = formModal({
      title: editing ? 'تعديل المشترك' : 'إضافة مشترك',
      values: sub || { status: 'active' },
      fields: [
        { name: 'name', label: 'الاسم', required: true, max: 100, full: true },
        { name: 'phone', label: 'رقم الهاتف', type: 'tel', max: 40 },
        { name: 'address', label: 'العنوان', max: 200 },
        { name: 'amps', label: 'عدد الأمبيرات', type: 'number' },
        { name: 'monthly_fee', label: `الاشتراك الشهري (${state.settings.currency})`, type: 'number', hint: price ? `يُحسب تلقائياً: الأمبيرات × ${fmt(price)}` : 'حدّد سعر الأمبير من الإعدادات ليُحسب تلقائياً' },
        { name: 'status', label: 'الحالة', type: 'select', options: [{ v: 'active', l: 'نشط' }, { v: 'inactive', l: 'متوقف' }] },
        { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
      ],
      onInput: (f, e) => {
        if (e.target.name === 'monthly_fee') f.dataset.touched = '1';
        if (e.target.name === 'amps' && !f.dataset.touched && price) f.elements.monthly_fee.value = Math.round(Number(e.target.value || 0) * price * 100) / 100;
      },
      onSubmit: async (d) => {
        await api(editing ? `/subscribers/${sub.id}` : '/subscribers', { method: editing ? 'PUT' : 'POST', body: d });
        toast(editing ? 'تم حفظ التعديل' : 'تمت إضافة المشترك');
        await render();
      }
    });
    if (editing) form.dataset.touched = '1';
  }

  async function paymentForm(pay, prefill = {}) {
    const options = await subscriberOptions({ withBalance: true });
    if (!options.length) { toast('أضف مشتركاً أولاً قبل تسجيل الدفعات', 'err'); return; }
    const editing = !!pay;
    formModal({
      title: editing ? 'تعديل الدفعة' : 'تسجيل دفعة',
      values: pay || { paid_at: today(), method: 'cash', ...prefill },
      fields: [
        { name: 'subscriber_id', label: 'المشترك', type: 'select', options, required: true, full: true },
        { name: 'amount', label: `المبلغ (${state.settings.currency})`, type: 'number', required: true },
        { name: 'paid_at', label: 'تاريخ الدفعة', type: 'date', required: true },
        { name: 'method', label: 'طريقة الدفع', type: 'select', options: OPT_METHODS },
        { name: 'note', label: 'ملاحظة', max: 500 }
      ],
      onSubmit: async (d) => {
        await api(editing ? `/payments/${pay.id}` : '/payments', { method: editing ? 'PUT' : 'POST', body: d });
        toast(editing ? 'تم حفظ التعديل' : 'تم تسجيل الدفعة');
        await render();
      }
    });
  }

  const EXPENSE_CATS = ['وقود', 'صيانة', 'زيوت وفلاتر', 'قطع غيار', 'رواتب عمال', 'إصلاح أسلاك', 'إيجار', 'أخرى'];
  function expenseForm(exp) {
    const editing = !!exp;
    formModal({
      title: editing ? 'تعديل المصروف' : 'إضافة مصروف',
      values: exp || { spent_at: today() },
      fields: [
        { name: 'category', label: 'نوع المصروف', required: true, list: EXPENSE_CATS, max: 60, full: true },
        { name: 'amount', label: `المبلغ (${state.settings.currency})`, type: 'number', required: true },
        { name: 'spent_at', label: 'التاريخ', type: 'date', required: true },
        { name: 'note', label: 'ملاحظة', max: 500, full: true }
      ],
      onSubmit: async (d) => {
        await api(editing ? `/expenses/${exp.id}` : '/expenses', { method: editing ? 'PUT' : 'POST', body: d });
        toast(editing ? 'تم حفظ التعديل' : 'تمت إضافة المصروف');
        await render();
      }
    });
  }

  async function subscriptionForm(defaultPeriod) {
    const options = await subscriberOptions({ activeOnly: true });
    if (!options.length) { toast('لا يوجد مشتركون نشطون', 'err'); return; }
    formModal({
      title: 'إضافة اشتراك لمشترك',
      values: { period: defaultPeriod || thisMonth() },
      fields: [
        { name: 'subscriber_id', label: 'المشترك', type: 'select', options, required: true, full: true },
        { name: 'period', label: 'الشهر', type: 'month', required: true },
        { name: 'amount', label: `المبلغ (${state.settings.currency})`, type: 'number', hint: 'اتركه فارغاً لاستخدام اشتراكه الشهري' }
      ],
      onSubmit: async (d) => {
        await api('/subscriptions', { method: 'POST', body: d });
        toast('تمت إضافة الاشتراك');
        await render();
      }
    });
  }

  /* ------------------------------------------------------------ */
  /* عناصر عرض مشتركة                                              */
  /* ------------------------------------------------------------ */
  const rowBtns = (kind, id, extra = '') =>
    `<div class="row-actions">${extra}<button class="icon-btn" type="button" data-action="edit-${kind}" data-id="${id}" aria-label="تعديل" title="تعديل">${icon('edit')}</button>` +
    `<button class="icon-btn del" type="button" data-action="delete-${kind}" data-id="${id}" aria-label="حذف" title="حذف">${icon('trash')}</button></div>`;
  const balanceCell = (b) => b > 0 ? `<b class="red">${money(b)}</b>` : b < 0 ? `<span class="green">رصيد زائد ${money(-b)}</span>` : '<span class="badge ok">مسدد</span>';
  const empty = (title, text, btn) => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ''}</div>`;
  const pageHead = (title, sub, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
  const addBtn = (action, label, data = '') => `<button class="btn accent" type="button" data-action="${action}" ${data}>${icon('plus')}${esc(label)}</button>`;

  /* ------------------------------------------------------------ */
  /* الصفحات                                                       */
  /* ------------------------------------------------------------ */
  async function pageDashboard() {
    const d = await api('/dashboard');
    const s = d.stats;
    const pct = Math.round(s.collection_rate * 100);
    const on = Math.round(s.collection_rate * 40);
    const meter = Array.from({ length: 40 }, (_, i) => `<i class="${i < on ? 'on' : ''}" style="--i:${i}"></i>`).join('');
    const opLabel = {
      payment: (o) => ({ t: `دفعة من ${esc(o.label)}`, sub: numTxt(o.date), cls: 'in', sign: '+', ic: 'wallet' }),
      expense: (o) => ({ t: `مصروف: ${esc(o.label)}`, sub: numTxt(o.date), cls: 'out', sign: '−', ic: 'receipt' }),
      subscription: (o) => ({ t: `اشتراك ${numTxt(o.date)} — ${esc(o.label)}`, sub: 'اشتراك شهري', cls: '', sign: '', ic: 'calendar' })
    };
    const noSubs = s.subscribers_total === 0;
    view.innerHTML = `
      ${pageHead('لوحة التحكم', state.settings.generator_name || 'ملخص حسابات المولدة', addBtn('add-payment', 'تسجيل دفعة') + addBtn('add-expense', 'إضافة مصروف'))}
      ${noSubs ? `<div class="start-banner"><p><b>ابدأ من هنا:</b> حدّد سعر الأمبير من الإعدادات، ثم أضف مشتركيك، ثم أصدر اشتراكات الشهر. ستظهر الأرقام هنا تلقائياً.</p>
        <div class="head-actions"><a class="btn ghost" href="#/settings">الإعدادات</a><button class="btn" type="button" data-action="add-subscriber">إضافة أول مشترك</button></div></div>` : ''}
      <section class="hero">
        <div class="hero-top">
          <div><p class="hero-label">صافي الربح</p>
            <p class="hero-value ${s.profit < 0 ? 'neg' : ''}"><span class="num">${fmt(s.profit)}</span><small>${cur()}</small></p>
            <p class="hero-note">المبالغ المستلمة ناقص المصاريف</p></div>
          <div class="hero-month"><b>هذا الشهر ${numTxt(s.month)}</b>
            <div><span>مستلم</span><span>${money(s.month_received)}</span></div>
            <div><span>مصاريف</span><span>${money(s.month_expenses)}</span></div></div>
        </div>
        <div class="meter" role="img" aria-label="نسبة التحصيل ${pct}%">${meter}</div>
        <div class="meter-legend"><span>تم تحصيل <b class="num">${pct}%</b> من الإيرادات</span><span>المتبقي على المشتركين ${money(s.debts)}</span></div>
      </section>
      <section class="strip">
        <div><p class="lbl">المشتركون</p><p class="val"><span class="num">${s.subscribers_total}</span></p><p class="sub">${s.subscribers_active} نشط</p></div>
        <div><p class="lbl">الإيرادات</p><p class="val">${money(s.revenue)}</p><p class="sub">مجموع الاشتراكات المُصدرة</p></div>
        <div><p class="lbl">المستلم</p><p class="val green">${money(s.received)}</p><p class="sub">مجموع الدفعات</p></div>
        <div><p class="lbl">الديون</p><p class="val ${s.debts > 0 ? 'red' : ''}">${money(s.debts)}</p><p class="sub">المتبقي على المشتركين</p></div>
        <div><p class="lbl">المصاريف</p><p class="val">${money(s.expenses)}</p><p class="sub">إجمالي المصروفات</p></div>
      </section>
      <div class="cols">
        <section class="panel"><h2>آخر الدفعات والعمليات</h2>
          ${d.recent.length ? `<ul class="ops">${d.recent.map((o) => { const x = opLabel[o.type](o); return `<li><span class="dot ${o.type}">${icon(x.ic)}</span>
            <div class="t"><b>${x.t}</b><small>${x.sub}</small></div>
            <span class="amt ${x.cls}">${moneySigned(x.sign, o.amount)}</span></li>`; }).join('')}</ul>` : empty('لا توجد عمليات بعد', 'ستظهر هنا الدفعات والمصاريف والاشتراكات فور تسجيلها.')}
        </section>
        <section class="panel"><h2>أعلى الديون</h2>
          ${d.top_debtors.length ? `<ul class="ops">${d.top_debtors.map((t) => `<li><div class="t"><b><a class="link" href="#/subscribers/${t.id}">${esc(t.name)}</a></b><small>${esc(t.phone) || 'بدون هاتف'}</small></div>
            <span class="amt out">${money(t.balance)}</span>
            <button class="btn sm ghost" type="button" data-action="add-payment" data-sub="${t.id}" data-amount="${t.balance}">دفعة</button></li>`).join('')}</ul>
            <p style="margin-top:10px"><a class="link" href="#/debts">عرض كل الديون</a></p>` : empty('لا توجد ديون', 'كل المشتركين مسددون.')}
        </section>
      </div>`;
  }

  async function pageSubscribers() {
    const { subscribers } = await api('/subscribers');
    cache.subs = Object.fromEntries(subscribers.map((s) => [s.id, s]));
    view.innerHTML = `${pageHead('المشتركون', `${subscribers.length} مشترك`, addBtn('add-subscriber', 'إضافة مشترك'))}
      ${subscribers.length ? `<div class="toolbar"><div class="field grow"><label for="q">بحث</label><input id="q" type="search" placeholder="الاسم أو الهاتف أو العنوان"></div></div>
      <div class="table-wrap"><table><thead><tr><th>المشترك</th><th>العنوان</th><th>الأمبير</th><th>الاشتراك الشهري</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead><tbody id="subRows"></tbody></table></div>`
        : `<div class="panel">${empty('لا يوجد مشتركون بعد', 'أضف أول مشترك لتبدأ بإصدار الاشتراكات وتسجيل الدفعات.', addBtn('add-subscriber', 'إضافة مشترك'))}</div>`}`;
    const draw = (list) => {
      $('#subRows').innerHTML = list.length ? list.map((s) => `<tr>
        <td><a class="link" href="#/subscribers/${s.id}">${esc(s.name)}</a><span class="sub num">${esc(s.phone)}</span></td>
        <td>${esc(s.address) || '<span class="muted">—</span>'}</td><td><span class="num">${fmt(s.amps)}</span></td><td>${money(s.monthly_fee)}</td>
        <td>${balanceCell(s.balance)}</td><td><span class="badge ${s.status === 'active' ? 'ok' : 'off'}">${s.status === 'active' ? 'نشط' : 'متوقف'}</span></td>
        <td>${rowBtns('subscriber', s.id)}</td></tr>`).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:26px">لا توجد نتائج مطابقة</td></tr>`;
    };
    if (subscribers.length) {
      draw(subscribers);
      $('#q').addEventListener('input', (e) => {
        const t = e.target.value.trim().toLowerCase();
        draw(subscribers.filter((s) => [s.name, s.phone, s.address].some((x) => String(x).toLowerCase().includes(t))));
      });
    }
  }

  async function pageSubscriber(id) {
    const d = await api(`/subscribers/${id}`);
    const s = d.subscriber;
    cache.subs = { [s.id]: s };
    cache.payments = Object.fromEntries(d.payments.map((p) => [p.id, p]));
    cache.subscriptions = Object.fromEntries(d.subscriptions.map((p) => [p.id, p]));
    view.innerHTML = `<a class="back" href="#/subscribers">${icon('back')} كل المشتركين</a>
      <div class="sub-head"><div><h1>${esc(s.name)} <span class="badge ${s.status === 'active' ? 'ok' : 'off'}">${s.status === 'active' ? 'نشط' : 'متوقف'}</span></h1>
        <div class="meta">${s.phone ? `<span class="num">${esc(s.phone)}</span>` : ''}${s.address ? `<span>${esc(s.address)}</span>` : ''}<span><span class="num">${fmt(s.amps)}</span> أمبير</span></div>
        ${s.notes ? `<p class="muted" style="margin-top:6px">${esc(s.notes)}</p>` : ''}</div>
        <div class="head-actions"><button class="btn ghost" type="button" data-action="edit-subscriber" data-id="${s.id}">${icon('edit')}تعديل</button>
        ${addBtn('add-subscription', 'اشتراك', `data-sub="${s.id}"`)}${addBtn('add-payment', 'تسجيل دفعة', `data-sub="${s.id}" data-amount="${s.balance > 0 ? s.balance : ''}"`)}</div></div>
      <section class="strip three">
        <div><p class="lbl">إجمالي الاشتراكات</p><p class="val">${money(s.billed)}</p></div>
        <div><p class="lbl">إجمالي المدفوع</p><p class="val green">${money(s.paid)}</p></div>
        <div><p class="lbl">المتبقي</p><p class="val ${s.balance > 0 ? 'red' : ''}">${money(Math.max(s.balance, 0))}</p>${s.balance < 0 ? `<p class="sub">رصيد زائد ${money(-s.balance)}</p>` : ''}</div>
      </section>
      <h2 class="section-title">الدفعات</h2>
      ${d.payments.length ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th><th></th></tr></thead><tbody>
        ${d.payments.map((p) => `<tr><td><span class="num">${esc(p.paid_at)}</span></td><td><b class="green">${money(p.amount)}</b></td><td>${METHODS[p.method] || ''}</td><td>${esc(p.note) || '<span class="muted">—</span>'}</td><td>${rowBtns('payment', p.id)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="panel">${empty('لا توجد دفعات', 'لم تُسجل أي دفعة لهذا المشترك بعد.')}</div>`}
      <h2 class="section-title">الاشتراكات الشهرية</h2>
      ${d.subscriptions.length ? `<div class="table-wrap"><table><thead><tr><th>الشهر</th><th>المبلغ</th><th></th></tr></thead><tbody>
        ${d.subscriptions.map((p) => `<tr><td><span class="num">${esc(p.period)}</span></td><td>${money(p.amount)}</td><td>${rowBtns('subscription', p.id)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="panel">${empty('لا توجد اشتراكات', 'أصدر اشتراكات الشهر من صفحة الاشتراكات أو أضف اشتراكاً لهذا المشترك.')}</div>`}`;
  }

  async function pageSubscriptions() {
    const period = cache.period || thisMonth();
    const { subscriptions } = await api(`/subscriptions?period=${encodeURIComponent(period)}`);
    cache.subscriptions = Object.fromEntries(subscriptions.map((x) => [x.id, x]));
    const total = subscriptions.reduce((a, x) => a + x.amount, 0);
    view.innerHTML = `${pageHead('الاشتراكات الشهرية', 'الاشتراك المُصدر يُضاف إلى ما على المشترك حتى يسدده', `<button class="btn accent" type="button" data-action="gen-subs">${icon('calendar')}إصدار اشتراكات الشهر</button><button class="btn ghost" type="button" data-action="add-subscription">${icon('plus')}اشتراك لمشترك</button>`)}
      <div class="toolbar"><div class="field"><label for="period">الشهر</label><input id="period" type="month" value="${esc(period)}"></div></div>
      ${subscriptions.length ? `<div class="table-wrap"><table><thead><tr><th>المشترك</th><th>المبلغ</th><th></th></tr></thead><tbody>
        ${subscriptions.map((x) => `<tr><td><a class="link" href="#/subscribers/${x.subscriber_id}">${esc(x.subscriber_name)}</a></td><td>${money(x.amount)}</td><td>${rowBtns('subscription', x.id)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>المجموع (${subscriptions.length})</td><td colspan="2">${money(total)}</td></tr></tfoot></table></div>`
        : `<div class="panel">${empty('لا توجد اشتراكات لهذا الشهر', 'اضغط «إصدار اشتراكات الشهر» لإنشاء اشتراك لكل مشترك نشط دفعة واحدة.')}</div>`}`;
    $('#period').addEventListener('change', (e) => { if (e.target.value) { cache.period = e.target.value; render(); } });
  }

  async function pageMoneyList(kind) {
    const isPay = kind === 'payments';
    const f = cache[kind + 'Filter'] || { from: '', to: '', subscriber_id: '' };
    const qs = new URLSearchParams();
    if (f.from) qs.set('from', f.from); if (f.to) qs.set('to', f.to);
    if (isPay && f.subscriber_id) qs.set('subscriber_id', f.subscriber_id);
    const data = await api(`/${kind}?${qs}`);
    const rows = data[kind];
    cache[kind] = Object.fromEntries(rows.map((r) => [r.id, r]));
    let subOpts = '';
    if (isPay) {
      const opts = await subscriberOptions();
      subOpts = `<div class="field"><label for="fs">المشترك</label><select id="fs"><option value="">الكل</option>${opts.map((o) => `<option value="${o.v}" ${String(o.v) === String(f.subscriber_id) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>`;
    }
    const head = isPay ? pageHead('الدفعات', 'كل المبالغ المستلمة من المشتركين', addBtn('add-payment', 'تسجيل دفعة'))
      : pageHead('المصاريف', 'الوقود والصيانة والرواتب وغيرها', addBtn('add-expense', 'إضافة مصروف'));
    view.innerHTML = `${head}
      <div class="toolbar">${subOpts}<div class="field"><label for="ff">من تاريخ</label><input id="ff" type="date" value="${esc(f.from)}"></div>
        <div class="field"><label for="ft">إلى تاريخ</label><input id="ft" type="date" value="${esc(f.to)}"></div>
        <button class="btn ghost" type="button" id="clearF">عرض الكل</button></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>${isPay ? 'المشترك' : 'النوع'}</th><th>المبلغ</th>${isPay ? '<th>الطريقة</th>' : ''}<th>ملاحظة</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><span class="num">${esc(isPay ? r.paid_at : r.spent_at)}</span></td>
          <td>${isPay ? `<a class="link" href="#/subscribers/${r.subscriber_id}">${esc(r.subscriber_name)}</a>` : esc(r.category)}</td>
          <td><b class="${isPay ? 'green' : 'red'}">${money(r.amount)}</b></td>${isPay ? `<td>${METHODS[r.method] || ''}</td>` : ''}
          <td>${esc(r.note) || '<span class="muted">—</span>'}</td><td>${rowBtns(isPay ? 'payment' : 'expense', r.id)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">المجموع (${rows.length})</td><td colspan="${isPay ? 4 : 3}">${money(data.total)}</td></tr></tfoot></table></div>`
        : `<div class="panel">${empty(isPay ? 'لا توجد دفعات' : 'لا توجد مصاريف', 'لا توجد سجلات ضمن هذا الفلتر.')}</div>`}`;
    const apply = () => {
      cache[kind + 'Filter'] = { from: $('#ff').value, to: $('#ft').value, subscriber_id: isPay ? $('#fs').value : '' };
      render();
    };
    $('#ff').addEventListener('change', apply); $('#ft').addEventListener('change', apply);
    if (isPay) $('#fs').addEventListener('change', apply);
    $('#clearF').addEventListener('click', () => { cache[kind + 'Filter'] = null; render(); });
  }

  async function pageDebts() {
    const { debts, total } = await api('/debts');
    cache.subs = Object.fromEntries(debts.map((s) => [s.id, s]));
    view.innerHTML = `${pageHead('الديون', debts.length ? `${debts.length} مشترك عليهم مبالغ متبقية` : '')}
      ${debts.length ? `<section class="strip three" style="margin-bottom:18px"><div><p class="lbl">إجمالي الديون</p><p class="val red">${money(total)}</p></div>
        <div><p class="lbl">عدد المدينين</p><p class="val"><span class="num">${debts.length}</span></p></div>
        <div><p class="lbl">أكبر دين</p><p class="val">${money(debts[0].balance)}</p><p class="sub">${esc(debts[0].name)}</p></div></section>
      <div class="table-wrap"><table><thead><tr><th>المشترك</th><th>الاشتراكات</th><th>المدفوع</th><th>المتبقي</th><th></th></tr></thead><tbody>
      ${debts.map((s) => `<tr><td><a class="link" href="#/subscribers/${s.id}">${esc(s.name)}</a><span class="sub num">${esc(s.phone)}</span></td>
        <td>${money(s.billed)}</td><td>${money(s.paid)}</td><td><b class="red">${money(s.balance)}</b></td>
        <td><div class="row-actions">${s.phone ? `<a class="icon-btn" href="tel:${esc(s.phone)}" aria-label="اتصال" title="اتصال">${icon('phone')}</a>` : ''}
        <button class="btn sm accent" type="button" data-action="add-payment" data-sub="${s.id}" data-amount="${s.balance}">تسجيل دفعة</button></div></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="panel">${empty('لا توجد ديون', 'كل المشتركين مسددون، أو لم تُصدر اشتراكات بعد.')}</div>`}`;
  }

  async function pageReports() {
    const year = cache.year || String(new Date().getFullYear());
    const r = await api(`/reports?year=${encodeURIComponent(year)}`);
    const max = Math.max(1, ...r.months.flatMap((m) => [m.received, m.expenses]));
    const maxCat = Math.max(1, ...r.expenses_by_category.map((c) => c.total));
    view.innerHTML = `${pageHead('التقارير', `السنة ${r.year}`, `<button class="btn ghost" type="button" data-action="print">${icon('print')}طباعة</button>`)}
      <div class="toolbar"><div class="field"><label for="yr">السنة</label><select id="yr">${r.years.map((y) => `<option ${y === r.year ? 'selected' : ''}>${y}</option>`).join('')}</select></div></div>
      <section class="strip four">
        <div><p class="lbl">الإيرادات</p><p class="val">${money(r.totals.revenue)}</p></div>
        <div><p class="lbl">المستلم</p><p class="val green">${money(r.totals.received)}</p></div>
        <div><p class="lbl">المصاريف</p><p class="val">${money(r.totals.expenses)}</p></div>
        <div><p class="lbl">صافي الربح</p><p class="val ${r.totals.profit < 0 ? 'red' : 'green'}">${money(r.totals.profit)}</p></div></section>
      <section class="panel"><h2>المستلم والمصاريف شهرياً</h2>
        <div class="bars">${r.months.map((m, i) => `<div class="col"><div class="pair"><span class="b in" style="height:${m.received / max * 100}%" title="مستلم ${fmt(m.received)}"></span><span class="b out" style="height:${m.expenses / max * 100}%" title="مصاريف ${fmt(m.expenses)}"></span></div><span class="lab num">${i + 1}</span></div>`).join('')}</div>
        <div class="legend"><span><i style="background:var(--green)"></i>مستلم</span><span><i style="background:var(--red)"></i>مصاريف</span></div></section>
      <h2 class="section-title">التفصيل الشهري</h2>
      <div class="table-wrap"><table><thead><tr><th>الشهر</th><th>الإيرادات</th><th>المستلم</th><th>المصاريف</th><th>الربح</th></tr></thead><tbody>
        ${r.months.map((m) => `<tr><td><span class="num">${m.month}</span></td><td>${moneyOrDash(m.revenue)}</td><td>${moneyOrDash(m.received)}</td><td>${moneyOrDash(m.expenses)}</td><td><b class="${m.profit < 0 ? 'red' : 'green'}">${moneyOrDash(m.profit)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>المجموع</td><td>${money(r.totals.revenue)}</td><td>${money(r.totals.received)}</td><td>${money(r.totals.expenses)}</td><td>${money(r.totals.profit)}</td></tr></tfoot></table></div>
      <div class="cols" style="margin-top:18px">
        <section class="panel"><h2>المصاريف حسب النوع</h2>${r.expenses_by_category.length ? r.expenses_by_category.map((c) => `<div class="cat-row"><span>${esc(c.category)}</span><div class="bar"><span style="width:${c.total / maxCat * 100}%"></span></div><b>${money(c.total)}</b></div>`).join('') : empty('لا توجد مصاريف', 'لم تُسجل مصاريف في هذه السنة.')}</section>
        <section class="panel"><h2>أكبر المدينين</h2>${r.top_debtors.length ? `<ul class="ops">${r.top_debtors.map((t) => `<li><div class="t"><b><a class="link" href="#/subscribers/${t.id}">${esc(t.name)}</a></b><small>${esc(t.phone) || ''}</small></div><span class="amt out">${money(t.balance)}</span></li>`).join('')}</ul>` : empty('لا توجد ديون', 'كل المشتركين مسددون.')}</section>
      </div>`;
    $('#yr').addEventListener('change', (e) => { cache.year = e.target.value; render(); });
  }

  async function pageSettings() {
    const { settings } = await api('/settings');
    state.settings = settings; applyBrand();
    view.innerHTML = `${pageHead('الإعدادات', 'بيانات المولدة وحسابك')}
      <div class="settings-grid">
        <section class="panel"><h2>إعدادات المولدة</h2>
          <form data-form="settings"><div class="form-grid">
            <div class="field full"><label for="s1">اسم المولدة</label><input id="s1" name="generator_name" maxlength="100" value="${esc(settings.generator_name)}"></div>
            <div class="field"><label for="s2">هاتف المولدة</label><input id="s2" name="phone" type="tel" maxlength="40" value="${esc(settings.phone)}"></div>
            <div class="field"><label for="s3">العنوان</label><input id="s3" name="address" maxlength="200" value="${esc(settings.address)}"></div>
            <div class="field"><label for="s4">العملة</label><input id="s4" name="currency" maxlength="12" required value="${esc(settings.currency)}"></div>
            <div class="field"><label for="s5">سعر الأمبير الشهري</label><input id="s5" name="price_per_amp" type="number" step="any" min="0" inputmode="decimal" required value="${esc(settings.price_per_amp)}"><small>يُستخدم لحساب اشتراك المشترك الجديد تلقائياً</small></div>
            <div class="field full"><label for="s6">ملاحظات</label><textarea id="s6" name="notes" maxlength="1000">${esc(settings.notes)}</textarea></div></div>
            <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn accent" type="submit">حفظ الإعدادات</button></div></form></section>
        <div style="display:grid;gap:18px">
          <section class="panel"><h2>الحساب</h2>
            <form data-form="profile"><div class="form-grid"><div class="field full"><label for="p1">الاسم</label><input id="p1" name="name" required maxlength="80" value="${esc(state.user.name)}"></div>
            <div class="field full"><label>البريد الإلكتروني</label><input value="${esc(state.user.email)}" disabled dir="ltr" style="text-align:right"></div></div>
            <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" type="submit">حفظ الاسم</button></div></form></section>
          <section class="panel"><h2>تغيير كلمة المرور</h2>
            <form data-form="password"><div class="form-grid"><div class="field full"><label for="w1">كلمة المرور الحالية</label><input id="w1" name="current" type="password" required autocomplete="current-password"></div>
            <div class="field full"><label for="w2">كلمة المرور الجديدة</label><input id="w2" name="next" type="password" required minlength="8" autocomplete="new-password"></div></div>
            <p class="form-error" role="alert" hidden></p><div class="modal-actions"><button class="btn" type="submit">تغيير كلمة المرور</button></div></form></section>
        </div></div>`;
  }

  /* ------------------------------------------------------------ */
  /* الإجراءات                                                     */
  /* ------------------------------------------------------------ */
  const actions = {
    'add-subscriber': () => subscriberForm(),
    'edit-subscriber': ({ id }) => subscriberForm(cache.subs[id]),
    'delete-subscriber': async ({ id }) => {
      const s = cache.subs[id];
      if (await confirmBox(`سيتم حذف «${s.name}» مع كل دفعاته واشتراكاته نهائياً. هل تريد المتابعة؟`)) {
        await doAction(async () => { await api(`/subscribers/${id}`, { method: 'DELETE' }); if (location.hash.startsWith('#/subscribers/')) location.hash = '#/subscribers'; }, 'تم حذف المشترك');
      }
    },
    'add-payment': ({ sub, amount }) => paymentForm(null, { subscriber_id: sub || '', amount: amount || '' }),
    'edit-payment': ({ id }) => paymentForm(cache.payments[id]),
    'delete-payment': async ({ id }) => {
      if (await confirmBox('هل تريد حذف هذه الدفعة؟ سيرجع المبلغ إلى ديون المشترك.')) await doAction(() => api(`/payments/${id}`, { method: 'DELETE' }), 'تم حذف الدفعة');
    },
    'add-expense': () => expenseForm(),
    'edit-expense': ({ id }) => expenseForm(cache.expenses[id]),
    'delete-expense': async ({ id }) => {
      if (await confirmBox('هل تريد حذف هذا المصروف؟')) await doAction(() => api(`/expenses/${id}`, { method: 'DELETE' }), 'تم حذف المصروف');
    },
    'add-subscription': ({ sub }) => subscriptionForm(cache.period).then(() => { if (sub) { const el = $('#f_subscriber_id'); if (el) el.value = sub; } }),
    'edit-subscription': ({ id }) => {
      const x = cache.subscriptions[id];
      formModal({
        title: `تعديل اشتراك ${x.period}`, values: { amount: x.amount },
        fields: [{ name: 'amount', label: `المبلغ (${state.settings.currency})`, type: 'number', required: true, full: true }],
        onSubmit: async (d) => { await api(`/subscriptions/${id}`, { method: 'PUT', body: d }); toast('تم حفظ التعديل'); await render(); }
      });
    },
    'delete-subscription': async ({ id }) => {
      if (await confirmBox('هل تريد حذف هذا الاشتراك؟')) await doAction(() => api(`/subscriptions/${id}`, { method: 'DELETE' }), 'تم حذف الاشتراك');
    },
    'gen-subs': async () => {
      const period = cache.period || thisMonth();
      if (await confirmBox(`سيتم إصدار اشتراك شهر ${period} لكل مشترك نشط لم يصدر له اشتراك بعد. هل تريد المتابعة؟`, 'إصدار')) {
        await doAction(async () => {
          const r = await api('/subscriptions/generate', { method: 'POST', body: { period } });
          toast(r.created ? `تم إصدار ${r.created} اشتراك` : 'كل المشتركين لديهم اشتراك لهذا الشهر');
        });
      }
    },
    print: () => window.print()
  };

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const fn = actions[b.dataset.action];
    if (fn) fn({ ...b.dataset });
  });

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const err = $('.form-error', form); const btn = $('button[type=submit]', form);
    err.hidden = true; btn.disabled = true;
    const d = Object.fromEntries(new FormData(form));
    try {
      if (form.dataset.form === 'settings') { const r = await api('/settings', { method: 'PUT', body: d }); state.settings = r.settings; applyBrand(); toast('تم حفظ الإعدادات'); }
      if (form.dataset.form === 'profile') { const r = await api('/auth/profile', { method: 'PUT', body: d }); state.user = r.user; applyUser(); toast('تم حفظ الاسم'); }
      if (form.dataset.form === 'password') { await api('/auth/password', { method: 'POST', body: d }); form.reset(); toast('تم تغيير كلمة المرور'); }
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false;
  });

  /* ------------------------------------------------------------ */
  /* التنقل                                                        */
  /* ------------------------------------------------------------ */
  const NAV = [
    ['dashboard', 'لوحة التحكم', 'grid'], ['subscribers', 'المشتركون', 'users'], ['subscriptions', 'الاشتراكات', 'calendar'],
    ['payments', 'الدفعات', 'wallet'], ['debts', 'الديون', 'alert'], ['expenses', 'المصاريف', 'receipt'],
    ['reports', 'التقارير', 'chart'], ['settings', 'الإعدادات', 'gear']
  ];
  const PAGES = {
    dashboard: pageDashboard, subscribers: (a) => (a ? pageSubscriber(a) : pageSubscribers()), subscriptions: pageSubscriptions,
    payments: () => pageMoneyList('payments'), expenses: () => pageMoneyList('expenses'), debts: pageDebts, reports: pageReports, settings: pageSettings
  };

  function applyBrand() { $('#genName').textContent = state.settings.generator_name || ''; }
  function applyUser() { $('#userName').textContent = state.user.name; $('#userEmail').textContent = state.user.email; }

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    const page = PAGES[name] ? name : 'dashboard';
    $$('#nav a').forEach((a) => { const on = a.dataset.page === page; a.classList.toggle('active', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
    $('#topTitle').textContent = (NAV.find((n) => n[0] === page) || [])[1] || 'مولّدتي';
    document.title = `${$('#topTitle').textContent} — مولّدتي`;
    document.body.classList.remove('nav-open');
    if (!view.children.length) view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    const scroll = window.scrollY;
    try {
      await PAGES[page](arg);
      if (seq === renderSeq) window.scrollTo(0, scroll);
    } catch (e) {
      if (seq !== renderSeq) return;
      view.innerHTML = `<div class="panel">${empty('تعذّر تحميل الصفحة', e.message, '<button class="btn" type="button" id="retry">إعادة المحاولة</button>')}</div>`;
      $('#retry').addEventListener('click', render);
    }
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); view.innerHTML = ''; render(); });

  $('#nav').innerHTML = NAV.map(([k, l, ic]) => `<a href="#/${k}" data-page="${k}">${icon(ic)}<span>${l}</span></a>`).join('');
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/login';
  });

  (async () => {
    try {
      state.user = (await api('/auth/me')).user;
      state.settings = (await api('/settings')).settings;
      applyUser(); applyBrand();
      await render();
    } catch (e) { if (e.message !== 'انتهت الجلسة') view.innerHTML = `<div class="panel">${empty('تعذّر الاتصال بالخادم', e.message)}</div>`; }
  })();
})();
