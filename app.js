'use strict';

const API_BASE = String(window.APP_CONFIG?.apiBase || '').replace(/\/$/, '');
const TOKEN_KEY = 'atlas_admin_token';
const storedToken = localStorage.getItem(TOKEN_KEY) || '';

const state = {
  companies: [],
  categories: [],
  histories: [],
  admins: [],
  stats: { companies: 0, categories: 0, histories: 0, qrImages: 0 },
  admin: null,
  query: '',
  category: '全部',
  followupFilter: '全部',
  sort: 'default',
  detailId: null,
  editorCompany: null,
  editorImages: [],
  adminTab: 'companies',
  adminQuery: '',
  importPreview: null,
  confirmAction: null,
  pendingAdminTab: new URLSearchParams(window.location.search).get('admin') === 'import' ? 'import' : '',
};

const $ = (id) => document.getElementById(id);
const FOLLOWUP_STAGES = ['未接触', '已联系', '已拜访', '意向确认', '合同洽谈', '已签约', '已回款'];

function followupStageClass(status) {
  const index = FOLLOWUP_STAGES.indexOf(status);
  return `stage-${index >= 0 ? index : 0}`;
}

function followupBadge(status) {
  return `<span class="followup-badge ${followupStageClass(status || '未接触')}"><i></i>${escapeHtml(status || '未接触')}</span>`;
}

const categoryColor = (name) => state.categories.find((item) => item.name === name)?.color || 'green';
const categoryDescription = (name) => state.categories.find((item) => item.name === name)?.description || '';

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value) {
  const url = String(value || '').trim();
  return /^(https?:\/\/|\/uploads\/|\/history\/)/i.test(url) ? url : '';
}

function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function truncate(value, length = 110) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function shortPhone(value) {
  const text = String(value || '').trim();
  if (!text) return '联系方式待补充';
  const first = text.split('/')[0].trim();
  return first.length > 28 ? `${first.slice(0, 28)}…` : first;
}

async function api(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const response = await fetch(API_BASE + url, {
    cache: 'no-store',
    credentials: API_BASE ? 'omit' : 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {}),
    },
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('toastRegion').appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    window.setTimeout(() => toast.remove(), 220);
  }, 3200);
}

function syncModalBody() {
  document.body.classList.toggle('modal-open', Boolean(document.querySelector('.modal:not([hidden])')));
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = false;
  syncModalBody();
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = true;
  syncModalBody();
}

function closeTopModal() {
  const visible = [...document.querySelectorAll('.modal:not([hidden])')];
  const top = visible[visible.length - 1];
  if (top) closeModal(top.id);
}

function setButtonLoading(button, loading, text = '处理中…') {
  if (!button) return;
  if (loading) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}

function renderAuth() {
  const loggedIn = Boolean(state.admin);
  $('loginBtn').hidden = loggedIn;
  $('adminBtn').hidden = !loggedIn;
  $('logoutBtn').hidden = !loggedIn;
  $('adminBadge').hidden = !loggedIn;
  if (loggedIn) {
    $('adminBadge').textContent = `管理员 · ${state.admin.username}`;
    $('adminWelcome').textContent = `${state.admin.username}，你可以维护企业档案、融合新表格和管理管理员账号。`;
  }
}

function renderStats() {
  $('statCompanies').textContent = state.stats.companies ?? state.companies.length;
  $('statCategories').textContent = state.stats.categories ?? state.categories.filter((item) => item.count).length;
  $('statHistories').textContent = state.stats.histories ?? state.histories.length;
  $('statQr').textContent = state.stats.qrImages ?? 0;
}

function renderCategories() {
  $('categoryGrid').innerHTML = state.categories.map((category) => `
    <button class="category-card category-${escapeHtml(category.color)}" type="button" data-category-jump="${escapeHtml(category.name)}">
      <span class="category-card-top"><span class="category-code">${escapeHtml(category.code)} / CATEGORY</span><span class="category-count">${category.count}</span></span>
      <h3>${escapeHtml(category.name)}</h3>
      <p>${escapeHtml(category.description)}</p>
      <span class="category-open"><span>查看企业</span><svg><use href="#icon-arrow"></use></svg></span>
    </button>
  `).join('');
}

function renderCategoryTabs() {
  const total = state.companies.length;
  const items = [{ name: '全部', count: total }, ...state.categories];
  $('categoryTabs').innerHTML = items.map((category) => `
    <button class="category-tab ${state.category === category.name ? 'is-active' : ''}" type="button" role="tab" aria-selected="${state.category === category.name}" data-filter-category="${escapeHtml(category.name)}">${escapeHtml(category.name)}<span>${category.count}</span></button>
  `).join('');
}

function getVisibleCompanies() {
  const query = state.query.trim().toLowerCase();
  let rows = state.companies.filter((company) => {
    if (state.category !== '全部' && company.category !== state.category) return false;
    if (state.followupFilter !== '全部' && (company.followUpStatus || '未接触') !== state.followupFilter) return false;
    if (!query) return true;
    const haystack = [company.name, company.contact, company.phone, company.positioning, company.notes, company.website, company.category, ...(company.relatedTags || [])].join(' ').toLowerCase();
    return haystack.includes(query);
  });
  if (state.sort === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  else if (state.sort === 'updated') rows = [...rows].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  else rows = [...rows].sort((a, b) => (a.sortOrder || 9999) - (b.sortOrder || 9999));
  return rows;
}

function companyCard(company, index) {
  const color = categoryColor(company.category);
  const tags = (company.relatedTags || []).slice(0, 3);
  return `
    <article class="company-card category-${escapeHtml(color)}" data-company-id="${escapeHtml(company.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(company.name)}">
      <div class="company-card-top"><span class="company-index">NO. ${String(index + 1).padStart(2, '0')}</span><div class="card-pills"><span class="category-pill">${escapeHtml(company.category)}</span>${followupBadge(company.followUpStatus)}</div></div>
      <h3><span>${escapeHtml(company.name)}</span></h3>
      <div class="company-meta">
        <span><i></i>${escapeHtml(company.contact || '联系人待补充')}</span>
        <span><i></i>${escapeHtml(company.region || shortPhone(company.phone))}</span>
        <span><i></i>${escapeHtml(shortPhone(company.phone))}</span>
      </div>
      <p class="company-position">${escapeHtml(truncate(company.positioning, 220) || '企业定位待补充。')}</p>
      <div class="company-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="company-card-foot">
        <span class="qr-note">${company.qrImages?.length ? `<svg><use href="#icon-qr"></use></svg>含 ${company.qrImages.length} 张截图` : '企业档案'}</span>
        <span class="open-note">查看详情<svg><use href="#icon-arrow"></use></svg></span>
      </div>
    </article>
  `;
}

function renderCompanies() {
  const rows = getVisibleCompanies();
  $('companyGrid').innerHTML = rows.map((company, index) => companyCard(company, index)).join('');
  $('emptyState').hidden = rows.length > 0;
  $('companyGrid').hidden = rows.length === 0;
  const filterText = state.category === '全部' ? '全部分类' : state.category;
  const statusText = state.followupFilter === '全部' ? '全部跟进状态' : `跟进：${state.followupFilter}`;
  const queryText = state.query.trim() ? ` · 搜索“${escapeHtml(state.query.trim())}”` : '';
  $('resultMeta').innerHTML = `显示 ${rows.length} / ${state.companies.length} 家 · ${escapeHtml(filterText)} · ${escapeHtml(statusText)}${queryText}`;
  $('clearFilterBtn').hidden = state.category === '全部' && state.followupFilter === '全部' && !state.query.trim();
}

function renderHistory() {
  if (!state.histories.length) {
    $('historyList').innerHTML = '<div class="empty-state"><h3>暂无历史表格</h3><p>管理员导入表格后会在这里留下原始文件链接。</p></div>';
    return;
  }
  $('historyList').innerHTML = state.histories.map((history, index) => `
    <article class="history-item">
      <span class="history-number">${String(index + 1).padStart(2, '0')}</span>
      <div class="history-copy"><h3>${escapeHtml(history.title)}</h3><p>${escapeHtml(history.originalName)} · ${escapeHtml(formatDate(history.uploadedAt, true))}${history.note ? ` · ${escapeHtml(truncate(history.note, 72))}` : ''}</p></div>
      <span class="history-count">${history.companyCount || 0} COMPANIES</span>
      <a class="history-link" href="${escapeHtml(safeUrl(history.fileUrl))}" target="_blank" rel="noopener"><svg><use href="#icon-link"></use></svg><span>打开原始表格</span></a>
    </article>
  `).join('');
}

function renderAll() {
  renderAuth();
  renderStats();
  renderCategories();
  renderCategoryTabs();
  renderFollowupTabs();
  renderCompanies();
  renderHistory();
  renderCompanySelect();
}

function renderCompanySelect() {
  $('editorCategory').innerHTML = state.categories.map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join('');
}

function sourceHistoryFor(company) {
  return state.histories.find((history) => history.id === company.sourceHistoryId) || null;
}

function openCompanyDetail(id) {
  const company = state.companies.find((item) => item.id === id);
  if (!company) return;
  state.detailId = id;
  const color = categoryColor(company.category);
  const source = sourceHistoryFor(company);
  const website = safeUrl(company.website);
  const qrImages = (company.qrImages || []).map((url) => safeUrl(url)).filter(Boolean);
  const sources = (company.sources || []).filter((source) => safeUrl(source.url));
  $('detailContent').innerHTML = `
    <div class="detail-hero detail-${escapeHtml(color)}" data-index="${String(company.sortOrder || 1).padStart(2, '0')}">
      <div class="detail-badge-row"><span class="detail-category">${escapeHtml(company.category)}</span>${followupBadge(company.followUpStatus)}</div>
      <h2 id="detailTitle">${escapeHtml(company.name)}</h2>
      <p class="detail-sub">${escapeHtml(categoryDescription(company.category))}</p>
    </div>
    <div class="detail-body">
      <div>
        <section class="detail-section"><h3>企业定位</h3><p>${escapeHtml(company.positioning || '暂未填写企业定位。')}</p></section>
        ${company.notes ? `<section class="detail-section"><h3>补充备注</h3><p>${escapeHtml(company.notes)}</p></section>` : ''}
        ${company.relatedTags?.length ? `<section class="detail-section"><h3>关联方向</h3><div class="detail-tags">${company.relatedTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></section>` : ''}
        ${qrImages.length ? `<section class="detail-section"><h3>二维码截图</h3><div class="detail-qr-grid">${qrImages.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="打开二维码截图 ${index + 1}"><img src="${escapeHtml(url)}" alt="${escapeHtml(company.name)} 二维码截图 ${index + 1}" loading="lazy"></a>`).join('')}</div></section>` : ''}
        ${state.admin ? followupEditorSection(company) : ''}
      </div>
      <aside>
        <div class="detail-facts">
          <div class="detail-fact"><span>REGION</span><strong>${escapeHtml(company.region || '待补充')}</strong></div>
          <div class="detail-fact"><span>COMPANY TYPE</span><strong>${escapeHtml(company.companyStatus || '待补充')}</strong></div>
          <div class="detail-fact"><span>CONTACT</span><strong>${escapeHtml(company.contact || '待补充')}</strong></div>
          <div class="detail-fact"><span>PHONE / EMAIL</span><strong>${escapeHtml(company.phone || '待补充')}</strong></div>
          <div class="detail-fact"><span>WEBSITE</span>${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener">${escapeHtml(truncate(website, 48))}</a>` : '<strong>待补充</strong>'}</div>
          <div class="detail-fact"><span>LAST UPDATED</span><strong>${escapeHtml(formatDate(company.updatedAt, true))}</strong></div>
        </div>
        ${sources.length ? `<div class="detail-source"><span>VERIFIED SOURCES · ${escapeHtml(company.verifiedAt || '公开资料')}</span>${sources.map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><svg><use href="#icon-link"></use></svg>${escapeHtml(item.label)} · ${escapeHtml(item.type || '来源')}</a>`).join('')}</div>` : ''}
        ${source ? `<div class="detail-source"><span>SOURCE TABLE</span><a href="${escapeHtml(safeUrl(source.fileUrl))}" target="_blank" rel="noopener"><svg><use href="#icon-link"></use></svg>${escapeHtml(source.title)}</a></div>` : ''}
        ${state.admin ? `<div class="detail-actions"><button class="button button-ink button-small" type="button" data-detail-edit="${escapeHtml(company.id)}"><svg><use href="#icon-edit"></use></svg>编辑公司</button><button class="button button-ghost button-small" type="button" data-detail-delete="${escapeHtml(company.id)}"><svg><use href="#icon-trash"></use></svg>删除</button></div>` : ''}
      </aside>
    </div>
  `;
  openModal('detailModal');
  if (state.admin) loadFollowUps(company.id);
}

function confirmAction(title, text, action, confirmLabel = '确认') {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmOkBtn').textContent = confirmLabel;
  state.confirmAction = action;
  openModal('confirmModal');
}

function renderEditorQrList() {
  $('editorQrList').innerHTML = state.editorImages.map((url) => `
    <div class="editor-qr-item"><img src="${escapeHtml(safeUrl(url))}" alt="二维码截图预览"><button type="button" data-remove-qr="${escapeHtml(url)}" aria-label="移除图片"><svg><use href="#icon-close"></use></svg></button></div>
  `).join('');
}

function openCompanyEditor(company = null) {
  state.editorCompany = company;
  state.editorImages = company ? [...(company.qrImages || [])] : [];
  const form = $('companyForm');
  form.reset();
  $('editorTitle').textContent = company ? '编辑公司信息' : '新增公司';
  $('companyFormError').hidden = true;
  form.elements.id.value = company?.id || '';
  form.elements.name.value = company?.name || '';
  form.elements.category.value = company?.category || '农业农村';
  form.elements.contact.value = company?.contact || '';
  form.elements.phone.value = company?.phone || '';
  form.elements.region.value = company?.region || '';
  form.elements.companyStatus.value = company?.companyStatus || '';
  form.elements.website.value = company?.website || '';
  form.elements.positioning.value = company?.positioning || '';
  form.elements.notes.value = company?.notes || '';
  form.elements.relatedTags.value = (company?.relatedTags || []).join('，');
  form.elements.sources.value = (company?.sources || []).map((source) => `${source.label} | ${source.url}`).join('\n');
  renderEditorQrList();
  openModal('editorModal');
}

function renderAdminCompanies() {
  const query = state.adminQuery.trim().toLowerCase();
  const rows = state.companies.filter((company) => !query || [company.name, company.category, company.contact, company.phone].join(' ').toLowerCase().includes(query));
  $('adminCompanyCount').textContent = `${rows.length} / ${state.companies.length} 家`;
  if (!rows.length) {
    $('adminCompanyList').innerHTML = '<div class="empty-state" style="padding:44px 20px"><h3>没有匹配企业</h3><p>尝试更换搜索词。</p></div>';
    return;
  }
  $('adminCompanyList').innerHTML = rows.map((company) => `
    <div class="admin-company-row">
      <div class="admin-company-name"><strong>${escapeHtml(company.name)}</strong><span>${escapeHtml(company.contact || '联系人待补充')} · ${escapeHtml(shortPhone(company.phone))}</span></div>
      <span class="admin-company-category">${escapeHtml(company.category)}<br>${followupBadge(company.followUpStatus)}</span>
      <span class="subtle-text">更新于 ${escapeHtml(formatDate(company.updatedAt))}</span>
      <div class="admin-row-actions"><button class="icon-button" type="button" data-admin-view="${escapeHtml(company.id)}" title="查看与跟进"><svg><use href="#icon-arrow"></use></svg></button><button class="icon-button" type="button" data-admin-edit="${escapeHtml(company.id)}" title="编辑"><svg><use href="#icon-edit"></use></svg></button><button class="icon-button danger" type="button" data-admin-delete="${escapeHtml(company.id)}" title="删除"><svg><use href="#icon-trash"></use></svg></button></div>
    </div>
  `).join('');
}

function setAdminTab(tab) {
  state.adminTab = tab;
  for (const button of document.querySelectorAll('[data-admin-tab]')) button.classList.toggle('is-active', button.dataset.adminTab === tab);
  $('adminCompaniesPanel').hidden = tab !== 'companies';
  $('adminImportPanel').hidden = tab !== 'import';
  $('adminAdminsPanel').hidden = tab !== 'admins';
  if (tab === 'companies') renderAdminCompanies();
  if (tab === 'admins') loadAdmins();
}

function openAdmin(tab = 'companies') {
  if (!state.admin) return;
  setAdminTab(tab);
  openModal('adminModal');
}

async function loadAdmins() {
  if (!state.admin) return;
  $('adminList').innerHTML = '<p class="subtle-text">正在载入管理员…</p>';
  try {
    const data = await api('/api/admins');
    $('adminList').innerHTML = data.admins.map((admin) => `
      <div class="admin-person"><div><strong>${escapeHtml(admin.username)}</strong><br><span>创建于 ${escapeHtml(formatDate(admin.createdAt))}</span></div>${admin.isInitial ? '<span class="admin-role">初始管理员</span>' : '<span class="admin-role">管理员</span>'}</div>
    `).join('');
  } catch (error) {
    $('adminList').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

function categoryOptions(selected) {
  return state.categories.map((category) => `<option value="${escapeHtml(category.name)}" ${category.name === selected ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
}

function renderImportPreview(preview) {
  state.importPreview = preview;
  const warnings = (preview.warnings || []).map((warning) => `<p class="import-warning">${escapeHtml(warning)}</p>`).join('');
  $('importPreview').hidden = false;
  $('importPreview').innerHTML = `
    <div class="import-preview-head"><div><h3>导入预览 · ${escapeHtml(preview.originalName)}</h3><p>识别工作表 ${escapeHtml(preview.sheetName)}，共 ${preview.summary.rows} 行；网站已有同名 ${preview.summary.duplicates} 家，将自动更新；文件内重复 ${preview.summary.duplicatesWithinFile || 0} 行，默认跳过；二维码截图 ${preview.summary.qrImages} 张。</p></div><span class="subtle-text">${escapeHtml(formatDate(new Date(), true))}</span></div>
    <div class="import-pending-note"><strong>当前仅为导入预览，网站数据尚未更新。</strong><span>请检查分类后，点击下方“确认导入并更新网站”。</span></div>
    ${warnings}
    <div class="import-table-wrap"><table class="import-table"><thead><tr><th><input id="previewSelectAll" type="checkbox" checked aria-label="全选公司"></th><th>公司名称</th><th>状态</th><th>主分类（可调整）</th><th>联系人</th><th>二维码</th></tr></thead><tbody>
      ${preview.companies.map((row) => `<tr data-preview-row="${row.sourceRow}"><td><input class="preview-include" type="checkbox" data-source-row="${row.sourceRow}" ${row.include === false ? '' : 'checked'} aria-label="选择 ${escapeHtml(row.name)}"></td><td class="preview-name">${escapeHtml(row.name)}<small>${escapeHtml(truncate(row.positioning, 80) || '未填写企业定位')}</small></td><td>${row.duplicateWithinFile ? '<span class="dup-badge">文件内重复</span>' : row.duplicate ? '<span class="dup-badge">更新</span>' : '<span class="new-badge">新增</span>'}</td><td><select class="preview-category" data-source-row="${row.sourceRow}">${categoryOptions(row.category)}</select></td><td>${escapeHtml(row.contact || '—')}</td><td>${row.qrImages.length ? `${row.qrImages.length} 张` : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="import-preview-actions"><button id="cancelImportBtn" class="button button-ghost" type="button">取消本次导入</button><button id="commitImportBtn" class="button button-ink" type="button">确认导入并更新网站</button></div>
  `;
}

function resetImportPreview() {
  state.importPreview = null;
  $('importPreview').hidden = true;
  $('importPreview').innerHTML = '';
}

function selectedImportRows() {
  if (!state.importPreview) return [];
  return state.importPreview.companies.map((row) => {
    const include = document.querySelector(`.preview-include[data-source-row="${row.sourceRow}"]`)?.checked ?? false;
    const category = document.querySelector(`.preview-category[data-source-row="${row.sourceRow}"]`)?.value || row.category;
    return { sourceRow: row.sourceRow, include, category };
  });
}

async function loadData() {
  const [bootstrap, auth] = await Promise.all([api('/api/bootstrap'), api('/api/auth/me')]);
  let admins = [];
  if (auth.admin) {
    try { admins = (await api('/api/admins')).admins || []; } catch { admins = [{ username: auth.admin.username, isInitial: auth.admin.isInitial }]; }
  }
  Object.assign(state, bootstrap, { admin: auth.admin, admins });
  renderAll();
  if (state.admin) {
    renderAdminCompanies();
    if (state.adminTab === 'admins') loadAdmins();
  }
}

function bindEvents() {
  $('loginBtn').addEventListener('click', () => { $('loginError').hidden = true; openModal('loginModal'); });
  $('adminBtn').addEventListener('click', () => openAdmin('companies'));
  $('logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem(TOKEN_KEY);
      state.admin = null;
      closeModal('adminModal');
      closeModal('detailModal');
      closeModal('editorModal');
      await loadData();
      showToast('已退出管理员账号。');
    } catch (error) { showToast(error.message, 'error'); }
  });

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const form = event.currentTarget;
    const errorBox = $('loginError');
    errorBox.hidden = true;
    setButtonLoading(button, true, '正在验证…');
    try {
      const formData = new FormData(form);
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(formData)) });
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      state.admin = data.admin;
      form.reset();
      closeModal('loginModal');
      await loadData();
      if (state.pendingAdminTab) {
        const tab = state.pendingAdminTab;
        state.pendingAdminTab = '';
        openAdmin(tab);
      }
      showToast(`欢迎回来，${data.admin.username}。`);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally { setButtonLoading(button, false); }
  });

  $('searchInput').addEventListener('input', (event) => { state.query = event.target.value; renderCompanies(); });
  $('sortSelect').addEventListener('change', (event) => { state.sort = event.target.value; renderCompanies(); });
  $('clearFilterBtn').addEventListener('click', resetFilters);
  $('emptyResetBtn').addEventListener('click', resetFilters);

  $('categoryGrid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-category-jump]');
    if (!card) return;
    state.category = card.dataset.categoryJump;
    renderCategoryTabs();
    renderCompanies();
    document.getElementById('directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('categoryTabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-filter-category]');
    if (!tab) return;
    state.category = tab.dataset.filterCategory;
    renderCategoryTabs();
    renderCompanies();
  });

  const followupTabs = $('followupTabs');
  if (followupTabs) followupTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-filter-followup]');
    if (!tab) return;
    state.followupFilter = tab.dataset.filterFollowup;
    renderFollowupTabs();
    renderCompanies();
  });

  document.querySelectorAll('[data-quick-search]').forEach((button) => {
    button.addEventListener('click', () => {
      state.query = button.dataset.quickSearch;
      state.category = '全部';
      $('searchInput').value = state.query;
      renderCategoryTabs();
      renderCompanies();
      document.getElementById('directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $('companyGrid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-company-id]');
    if (card) openCompanyDetail(card.dataset.companyId);
  });
  $('companyGrid').addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const card = event.target.closest('[data-company-id]');
    if (!card) return;
    event.preventDefault();
    openCompanyDetail(card.dataset.companyId);
  });

  $('detailContent').addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-detail-edit]');
    const deleteButton = event.target.closest('[data-detail-delete]');
    if (editButton) openCompanyEditor(state.companies.find((company) => company.id === editButton.dataset.detailEdit));
    if (deleteButton) requestDeleteCompany(deleteButton.dataset.detailDelete);
  });

  $('newCompanyBtn').addEventListener('click', () => openCompanyEditor());
  $('adminSearchInput').addEventListener('input', (event) => { state.adminQuery = event.target.value; renderAdminCompanies(); });
  document.querySelectorAll('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => setAdminTab(button.dataset.adminTab)));
  $('adminCompanyList').addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-admin-view]');
    const editButton = event.target.closest('[data-admin-edit]');
    const deleteButton = event.target.closest('[data-admin-delete]');
    if (viewButton) openCompanyDetail(viewButton.dataset.adminView);
    if (editButton) openCompanyEditor(state.companies.find((company) => company.id === editButton.dataset.adminEdit));
    if (deleteButton) requestDeleteCompany(deleteButton.dataset.adminDelete);
  });
}

function resetFilters() {
  state.query = '';
  state.category = '全部';
  state.followupFilter = '全部';
  state.sort = 'default';
  $('searchInput').value = '';
  $('sortSelect').value = 'default';
  renderCategoryTabs();
  renderFollowupTabs();
  renderCompanies();
}

function requestDeleteCompany(id) {
  const company = state.companies.find((item) => item.id === id);
  if (!company) return;
  confirmAction('删除企业档案', `确定删除“${company.name}”吗？原始历史表格不会被删除，但公司当前档案会从目录中移除。`, async () => {
    await api(`/api/companies/${encodeURIComponent(id)}`, { method: 'DELETE' });
    closeModal('detailModal');
    await loadData();
    showToast('企业档案已删除。');
  }, '确认删除');
}

function bindForms() {
  $('companyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const errorBox = $('companyFormError');
    errorBox.hidden = true;
    setButtonLoading(button, true, '正在保存…');
    try {
      const values = Object.fromEntries(new FormData(form));
      const existing = state.editorCompany;
      const payload = {
        name: values.name,
        category: values.category,
        contact: values.contact,
        phone: values.phone,
        region: values.region,
        companyStatus: values.companyStatus,
        website: values.website,
        positioning: values.positioning,
        notes: values.notes,
        relatedTags: String(values.relatedTags || '').split(/[，,、]/).map((item) => item.trim()).filter(Boolean),
        qrImages: state.editorImages,
        sources: values.sources,
        verifiedAt: existing?.verifiedAt || (values.sources ? new Date().toISOString().slice(0, 10) : null),
        sortOrder: existing?.sortOrder || state.companies.length + 1,
        sourceHistoryId: existing?.sourceHistoryId || null,
        sourceRow: existing?.sourceRow || null,
      };
      const url = existing ? `/api/companies/${encodeURIComponent(existing.id)}` : '/api/companies';
      await api(url, { method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      closeModal('editorModal');
      closeModal('detailModal');
      await loadData();
      showToast(existing ? '公司信息已更新。' : '公司信息已新增。');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally { setButtonLoading(button, false); }
  });

  $('qrFileInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return showToast('图片不能超过 10MB。', 'error');
    const button = document.querySelector('.upload-trigger');
    setButtonLoading(button, true, '上传中…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await api('/api/uploads', { method: 'POST', body: formData });
      state.editorImages.push(data.url);
      renderEditorQrList();
      showToast('二维码截图已上传。');
    } catch (error) { showToast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  });

  $('editorQrList').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-qr]');
    if (!remove) return;
    state.editorImages = state.editorImages.filter((url) => url !== remove.dataset.removeQr);
    renderEditorQrList();
  });
}

function bindImport() {
  const fileInput = $('importFileInput');
  const dropTarget = document.querySelector('.drop-target');
  const updateFileLabel = () => {
    const file = fileInput.files?.[0];
    $('importFileLabel').textContent = file ? file.name : '选择或拖入企业表格';
  };
  fileInput.addEventListener('change', updateFileLabel);
  dropTarget.addEventListener('dragover', (event) => { event.preventDefault(); dropTarget.classList.add('is-dragging'); });
  dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('is-dragging'));
  dropTarget.addEventListener('drop', (event) => {
    event.preventDefault();
    dropTarget.classList.remove('is-dragging');
    if (event.dataTransfer.files?.length) {
      fileInput.files = event.dataTransfer.files;
      updateFileLabel();
    }
  });

  $('importForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) return showToast('请先选择企业表格。', 'error');
    if (file.size > 50 * 1024 * 1024) return showToast('表格不能超过 100MB。', 'error');
    const button = event.submitter;
    setButtonLoading(button, true, '正在自动识别并更新网站…');
    resetImportPreview();
    let preview = null;
    try {
      const signed = await api('/api/import/sign', {
        method: 'POST',
        body: JSON.stringify({ originalName: file.name, size: file.size, mimeType: file.type }),
      });
      const upload = await fetch(signed.signedUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: file,
      });
      if (!upload.ok) throw new Error('表格上传失败（' + upload.status + '）。');
      preview = await api('/api/import/preview', {
        method: 'POST',
        body: JSON.stringify({ bucket: signed.bucket, path: signed.path, originalName: file.name, size: file.size, mimeType: file.type }),
      });
      const rows = preview.companies.map((row) => ({ sourceRow: row.sourceRow, include: row.include !== false, category: row.category }));
      if (!rows.some((row) => row.include)) throw new Error('表格中没有可导入的新公司。');
      const result = await api('/api/import/commit', {
        method: 'POST',
        body: JSON.stringify({ token: preview.token, title: $('importTitle').value, companies: rows }),
      });
      $('importForm').reset();
      updateFileLabel();
      await loadData();
      closeModal('adminModal');
      document.getElementById('directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('网站已更新：新增 ' + result.merge.inserted + ' 家，更新 ' + result.merge.updated + ' 家，跳过 ' + result.merge.skipped + ' 家。');
    } catch (error) {
      if (preview) { renderImportPreview(preview); $('importPreview').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      showToast(error.message, 'error');
    }
    finally { setButtonLoading(button, false); }
  });

  $('adminImportPanel').addEventListener('click', async (event) => {
    if (event.target.closest('#cancelImportBtn')) {
      const token = state.importPreview?.token;
      if (token) { try { await api('/api/import/preview/' + encodeURIComponent(token), { method: 'DELETE' }); } catch {} }
      resetImportPreview();
      $('importForm').reset();
      updateFileLabel();
      return;
    }
    const commitButton = event.target.closest('#commitImportBtn');
    if (!commitButton || !state.importPreview) return;
    const companies = selectedImportRows();
    if (!companies.some((row) => row.include)) return showToast('请至少选择一家公司。', 'error');
    setButtonLoading(commitButton, true, '正在融合…');
    try {
      const result = await api('/api/import/commit', {
        method: 'POST',
        body: JSON.stringify({ token: state.importPreview.token, title: $('importTitle').value, companies }),
      });
      resetImportPreview();
      $('importForm').reset();
      updateFileLabel();
      closeModal('adminModal');
      await loadData();
      document.getElementById('directory').scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`网站已更新：新增 ${result.merge.inserted} 家，更新 ${result.merge.updated} 家，跳过 ${result.merge.skipped} 家。`);
    } catch (error) { showToast(error.message, 'error'); }
    finally { setButtonLoading(commitButton, false); }
  });

  $('adminImportPanel').addEventListener('change', (event) => {
    if (event.target.id === 'previewSelectAll') {
      document.querySelectorAll('.preview-include').forEach((checkbox) => { checkbox.checked = event.target.checked; });
    }
  });

  $('adminForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const errorBox = $('adminFormError');
    errorBox.hidden = true;
    setButtonLoading(button, true, '正在创建…');
    try {
      const values = Object.fromEntries(new FormData(form));
      await api('/api/admins', { method: 'POST', body: JSON.stringify(values) });
      form.reset();
      await loadAdmins();
      showToast('新管理员已创建。');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally { setButtonLoading(button, false); }
  });
}

function bindGlobalUi() {
  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-close-modal]');
    if (closeButton) closeModal(closeButton.dataset.closeModal);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTopModal();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('searchInput').focus();
    }
  });

  $('confirmCancelBtn').addEventListener('click', () => { state.confirmAction = null; closeModal('confirmModal'); });
  $('confirmOkBtn').addEventListener('click', async () => {
    const action = state.confirmAction;
    state.confirmAction = null;
    closeModal('confirmModal');
    if (!action) return;
    try { await action(); } catch (error) { showToast(error.message, 'error'); }
  });
}

function bindPasswordForm() {
  $('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const errorBox = $('passwordFormError');
    errorBox.hidden = true;
    setButtonLoading(button, true, '正在更新…');
    try {
      const values = Object.fromEntries(new FormData(form));
      await api('/api/admins/me/password', { method: 'PUT', body: JSON.stringify(values) });
      form.reset();
      showToast('密码已更新，请妥善保管新密码。');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally { setButtonLoading(button, false); }
  });
}

async function init() {
  bindEvents();
  bindForms();
  bindImport();
  bindPasswordForm();
  bindGlobalUi();
  try {
    await loadData();
    if (state.pendingAdminTab) {
      if (state.admin) {
        const tab = state.pendingAdminTab;
        state.pendingAdminTab = '';
        openAdmin(tab);
      } else {
        $('loginError').hidden = true;
        openModal('loginModal');
      }
    }
  } catch (error) {
    document.getElementById('companyGrid').innerHTML = `<div class="empty-state"><h3>数据加载失败</h3><p>${escapeHtml(error.message)}</p><button class="button button-ink" type="button" id="reloadDataBtn">重新加载</button></div>`;
    document.getElementById('reloadDataBtn')?.addEventListener('click', () => location.reload());
    showToast(error.message, 'error');
  }
}

init();

function followupStageOptions(selected) {
  return FOLLOWUP_STAGES.map((stage) => `<option value="${stage}" ${stage === selected ? 'selected' : ''}>${stage}</option>`).join('');
}

function followupEditorSection(company) {
  return `
    <section class="detail-section followup-section">
      <div class="followup-title"><h3>跟进动态</h3><span>每次确认都会保留一条动态记录</span></div>
      <form id="followupForm" class="followup-form" data-company-id="${escapeHtml(company.id)}">
        <div class="followup-form-grid">
          <label class="field"><span>当前阶段 *</span><select name="status" required>${followupStageOptions(company.followUpStatus || '未接触')}</select></label>
          <label class="field"><span>负责人 *</span><select name="owner" required>${followupAdminOptions()}</select></label>
          <label class="field field-span-2"><span>当前进展 *</span><textarea name="currentProgress" rows="3" maxlength="3000" required placeholder="例如：已完成首次电话沟通，介绍了低空农业解决方案"></textarea></label>
          <label class="field field-span-2"><span>下一步进展</span><textarea name="nextStep" rows="2" maxlength="3000" placeholder="例如：下周发送方案，并约客户现场拜访"></textarea></label>
        </div>
        <div class="followup-form-actions"><button class="button button-ink button-small" type="submit">确认并保存跟进</button></div>
      </form>
      <div id="followupHistory" class="followup-history"><p class="subtle-text">正在载入跟进动态…</p></div>
    </section>
  `;
}

function renderFollowupHistory(followUps) {
  if (!followUps.length) {
    return '<div class="followup-empty">还没有跟进动态。保存第一条进展后，动态会显示在这里。</div>';
  }
  return followUps.map((item, index) => `
    <article class="followup-entry">
      <div class="followup-entry-head">
        <div class="followup-entry-badges">${followupBadge(item.status)}<span class="followup-sequence">#${String(followUps.length - index).padStart(2, '0')}</span></div>
        <time>${escapeHtml(formatDate(item.createdAt, true))}</time>
      </div>
      <div class="followup-entry-meta"><span>负责人：${escapeHtml(item.owner || '未填写')}</span><span>提交人：${escapeHtml(item.createdBy || '—')}</span></div>
      <div class="followup-entry-copy"><span>当前进展</span><p>${escapeHtml(item.currentProgress || '—')}</p></div>
      ${item.nextStep ? `<div class="followup-entry-copy next"><span>下一步进展</span><p>${escapeHtml(item.nextStep)}</p></div>` : ''}
      <button class="followup-delete" type="button" data-delete-followup="${escapeHtml(item.id)}" data-company-id="${escapeHtml(item.companyId)}"><svg><use href="#icon-trash"></use></svg>删除动态</button>
    </article>
  `).join('');
}

async function loadFollowUps(companyId) {
  const container = $('followupHistory');
  if (!container) return;
  container.innerHTML = '<p class="subtle-text">正在载入跟进动态…</p>';
  try {
    const data = await api(`/api/companies/${encodeURIComponent(companyId)}/followups`);
    const current = $('followupHistory');
    if (current) current.innerHTML = renderFollowupHistory(data.followUps || []);
  } catch (error) {
    const current = $('followupHistory');
    if (current) current.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

document.getElementById('detailContent').addEventListener('submit', async (event) => {
  const form = event.target.closest('#followupForm');
  if (!form) return;
  event.preventDefault();
  const companyId = form.dataset.companyId;
  const button = event.submitter;
  setButtonLoading(button, true, '正在保存…');
  try {
    const values = Object.fromEntries(new FormData(form));
    await api(`/api/companies/${encodeURIComponent(companyId)}/followups`, { method: 'POST', body: JSON.stringify(values) });
    await loadData();
    openCompanyDetail(companyId);
    showToast('跟进动态已保存。');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
  }
});

document.getElementById('detailContent').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-followup]');
  if (!button) return;
  const companyId = button.dataset.companyId;
  confirmAction('删除跟进动态', '确定删除这条跟进动态吗？删除后当前阶段会自动回退到最近一条剩余记录。', async () => {
    await api(`/api/followups/${encodeURIComponent(button.dataset.deleteFollowup)}`, { method: 'DELETE' });
    await loadData();
    openCompanyDetail(companyId);
    showToast('跟进动态已删除。');
  }, '确认删除');
});

function renderFollowupTabs() {
  const counts = Object.fromEntries(FOLLOWUP_STAGES.map((stage) => [stage, 0]));
  for (const company of state.companies) {
    const status = company.followUpStatus || '未接触';
    counts[status] = (counts[status] || 0) + 1;
  }
  const items = [{ name: '全部', count: state.companies.length }, ...FOLLOWUP_STAGES.map((name) => ({ name, count: counts[name] || 0 }))];
  const container = $('followupTabs');
  if (!container) return;
  container.innerHTML = items.map((item) => `
    <button class="followup-tab ${state.followupFilter === item.name ? 'is-active' : ''} ${item.name === '全部' ? '' : followupStageClass(item.name)}" type="button" role="tab" aria-selected="${state.followupFilter === item.name}" data-filter-followup="${item.name}">
      <i></i>${item.name}<span>${item.count}</span>
    </button>
  `).join('');
}

function followupAdminOptions() {
  const admins = state.admins.length ? state.admins : (state.admin ? [{ username: state.admin.username }] : []);
  const selected = state.admin?.username || admins[0]?.username || '';
  if (!admins.length) return '<option value="">暂无管理员</option>';
  return admins.map((admin) => `<option value="${escapeHtml(admin.username)}" ${admin.username === selected ? 'selected' : ''}>${escapeHtml(admin.username)}</option>`).join('');
}
