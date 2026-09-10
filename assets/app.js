/* 交互层：识别队列、校对入库、统计看板、筛选、导入导出 */
(function () {
  const $ = id => document.getElementById(id);
  const S = window.Store;

  let queue = [];          // 待识别图片
  let drafts = [];         // 识别结果（未入库）
  let charts = {};         // Chart.js 实例
  let busy = false;

  /* ---------- 基础 UI ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function fmt(n) {
    if (n == null || n === '' || isNaN(n)) return '-';
    return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function currentTpl() {
    return window.TEMPLATES[S.settings.template] || window.TEMPLATES.receipt;
  }

  /* 多指标模板（如创作者周报）的统计口径切换 */
  function metricField() {
    const tpl = currentTpl();
    const sel = $('metricSelect');
    if (!sel.hidden && sel.value) return sel.value;
    return tpl.numericField;
  }

  function metricLabel() {
    const tpl = currentTpl();
    const sel = $('metricSelect');
    if (!sel.hidden && sel.value) {
      const o = (tpl.numericOptions || []).find(x => x.key === sel.value);
      if (o) return o.label;
    }
    return tpl.numericLabel;
  }

  function buildMetricSelect() {
    const tpl = currentTpl();
    const sel = $('metricSelect');
    if (!tpl.numericOptions) { sel.hidden = true; sel.innerHTML = ''; return; }
    sel.hidden = false;
    sel.innerHTML = tpl.numericOptions.map(o => '<option value="' + o.key + '">' + o.label + '</option>').join('');
    sel.value = tpl.numericField;
  }

  /* ---------- 模板下拉 ---------- */
  function initTemplates() {
    const sel = $('tplSelect');
    sel.innerHTML = '';
    window.TEMPLATE_ORDER.forEach(id => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = window.TEMPLATES[id].name;
      sel.appendChild(o);
    });
    sel.value = S.settings.template;
    sel.onchange = () => {
      S.saveSettings({ template: sel.value });
      drafts = [];
      renderDrafts();
      $('fCategory').value = '';
      buildMetricSelect();
      renderAll();
    };
    buildMetricSelect();
  }

  /* ---------- 图片队列 ---------- */
  function addFiles(fileList) {
    const files = Array.prototype.slice.call(fileList).filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    files.forEach(f => {
      S.makeThumb(f, 720).then(thumb => {
        queue.push({ id: S.uid(), name: f.name || ('照片' + (queue.length + 1)), file: f, thumb });
        renderPreviews();
      });
    });
  }

  function renderPreviews() {
    const box = $('previewStrip');
    box.innerHTML = '';
    queue.forEach((item, i) => {
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = '<img src="' + item.thumb + '" alt=""><button class="del" title="移除">&times;</button><span class="name">' + (i + 1) + '. ' + item.name + '</span>';
      d.querySelector('.del').onclick = () => { queue.splice(i, 1); renderPreviews(); };
      d.querySelector('img').onclick = () => showImage(item.thumb);
      box.appendChild(d);
    });
  }

  function showImage(src) {
    if (!src) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = '<div class="modal-body" style="text-align:center"><img src="' + src + '" style="max-width:100%;max-height:80vh;border-radius:8px"></div>';
    wrap.onclick = () => wrap.remove();
    document.body.appendChild(wrap);
  }

  /* ---------- 识别 ---------- */
  function runQueue() {
    if (busy) return;
    if (!queue.length) return toast('请先添加照片');
    const engine = $('engineSelect').value;
    busy = true;
    $('btnRun').disabled = true;
    $('progressWrap').hidden = false;

    const tpl = currentTpl();
    const cfg = S.settings;
    const total = queue.length;
    const out = [];
    let idx = 0;

    function step() {
      if (idx >= total) return Promise.resolve();
      const item = queue[idx];
      const pct = Math.round((idx / total) * 100);
      $('progressFill').style.width = pct + '%';
      $('progressText').textContent = '正在识别第 ' + (idx + 1) + '/' + total + ' 张：' + item.name;

      return window.Extract.run(item.file, tpl, engine, cfg, (status) => {
        if (status) $('progressText').textContent = '正在识别第 ' + (idx + 1) + '/' + total + ' 张：' + item.name + '（' + status + '）';
      }).then(res => {
        res.rows.forEach(fields => {
          out.push({
            id: S.uid(),
            template: tpl.id,
            fields: fields,
            thumb: item.thumb,
            source: engine,
            createdAt: Date.now()
          });
        });
      }).catch(err => {
        console.error(err);
        toast('「' + item.name + '」识别失败：' + err.message);
        out.push({
          id: S.uid(), template: tpl.id, fields: window.emptyFields(tpl),
          thumb: item.thumb, source: 'manual', createdAt: Date.now()
        });
      }).then(() => { idx++; return step(); });
    }

    step().then(() => {
      $('progressFill').style.width = '100%';
      $('progressText').textContent = '识别完成，共提取 ' + out.length + ' 条记录，请在校对表中确认';
      drafts = drafts.concat(out);
      queue = [];
      renderPreviews();
      renderDrafts();
      busy = false;
      $('btnRun').disabled = false;
    });
  }

  /* ---------- 校对表 ---------- */
  function renderDrafts() {
    const card = $('draftCard');
    card.hidden = drafts.length === 0;
    if (!drafts.length) return;
    const tpl = currentTpl();
    const thead = $('draftTable').querySelector('thead');
    const tbody = $('draftTable').querySelector('tbody');
    thead.innerHTML = '<tr><th>#</th><th>来源</th>' + tpl.fields.map(f => '<th>' + f.label + '</th>').join('') + '<th>操作</th></tr>';
    tbody.innerHTML = '';
    drafts.forEach((d, i) => {
      const tr = document.createElement('tr');
      let html = '<td>' + (i + 1) + '</td><td><span class="src-tag' + (d.source === 'manual' ? ' manual' : '') + '">' +
        (d.source === 'ai' ? 'AI' : d.source === 'manual' ? '待补录' : 'OCR') + '</span></td>';
      tpl.fields.forEach(f => {
        html += '<td' + (f.type === 'number' ? ' class="num"' : '') + '>' + inputHtml(f, d.fields[f.key], d.id, 'draft') + '</td>';
      });
      html += '<td><button class="btn sm" data-del="' + d.id + '">删除</button></td>';
      tr.innerHTML = html;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => { drafts = drafts.filter(x => x.id !== b.dataset.del); renderDrafts(); };
    });
  }

  function inputHtml(field, value, ownerId, scope) {
    const attr = 'data-scope="' + scope + '" data-owner="' + ownerId + '" data-key="' + field.key + '"';
    const v = value == null ? '' : value;
    if (field.type === 'select') {
      return '<select ' + attr + '><option value=""></option>' +
        field.options.map(o => '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') +
        '</select>';
    }
    const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
    return '<input type="' + type + '" ' + (type === 'number' ? 'step="any" ' : '') + attr + ' value="' + String(v).replace(/"/g, '&quot;') + '">';
  }

  // 统一的单元格编辑监听
  document.addEventListener('change', e => {
    const el = e.target;
    const scope = el.dataset && el.dataset.scope;
    if (!scope) return;
    const key = el.dataset.key;
    let val = el.value;
    if (scope === 'draft') {
      const d = drafts.find(x => x.id === el.dataset.owner);
      if (d) d.fields[key] = val;
    } else {
      const r = S.records.find(x => x.id === el.dataset.owner);
      if (r) {
        const patch = {}; patch[key] = val;
        S.update(r.id, patch);
        renderAll();
      }
    }
  });

  function saveDrafts() {
    if (!drafts.length) return;
    if (S.addMany(drafts)) {
      toast('已入库 ' + drafts.length + ' 条记录');
      drafts = [];
      renderDrafts();
      renderAll();
    }
  }

  /* ---------- 明细表 ---------- */
  function renderRecords() {
    const tpl = currentTpl();
    const list = S.filter({
      template: tpl.id,
      dateFrom: $('fDateFrom').value,
      dateTo: $('fDateTo').value,
      category: $('fCategory').value,
      categoryKey: tpl.categoryField,
      keyword: $('fKeyword').value
    });
    const thead = $('recordTable').querySelector('thead');
    const tbody = $('recordTable').querySelector('tbody');
    thead.innerHTML = '<tr><th>#</th><th>照片</th><th>入库时间</th>' +
      tpl.fields.map(f => '<th>' + f.label + '</th>').join('') + '<th>操作</th></tr>';
    tbody.innerHTML = '';
    list.forEach((r, i) => {
      const tr = document.createElement('tr');
      let html = '<td>' + (i + 1) + '</td>' +
        '<td>' + (r.thumb ? '<img src="' + r.thumb + '" style="width:34px;height:34px;object-fit:cover;border-radius:5px;cursor:zoom-in" data-img="' + r.id + '">' : '') + '</td>' +
        '<td>' + new Date(r.createdAt || Date.now()).toLocaleString('zh-CN') + '</td>';
      tpl.fields.forEach(f => {
        html += '<td' + (f.type === 'number' ? ' class="num"' : '') + '>' + inputHtml(f, r.fields[f.key], r.id, 'record') + '</td>';
      });
      html += '<td><button class="btn sm" data-rm="' + r.id + '">删除</button></td>';
      tr.innerHTML = html;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('[data-rm]').forEach(b => {
      b.onclick = () => { if (confirm('确定删除这条记录？')) { S.remove(b.dataset.rm); renderAll(); } };
    });
    tbody.querySelectorAll('[data-img]').forEach(im => {
      im.onclick = () => { const r = S.records.find(x => x.id === im.dataset.img); if (r) showImage(r.thumb); };
    });
    $('recordEmpty').hidden = list.length > 0;
    $('countLabel').textContent = '共 ' + list.length + ' 条（当前模板：' + tpl.name + '）';
    $('scopeLabel').textContent = '统计范围：' + tpl.name + ' · ' + list.length + ' 条';
    return list;
  }

  function renderCategoryFilter() {
    const tpl = currentTpl();
    const sel = $('fCategory');
    const keep = sel.value;
    const set = {};
    S.records.forEach(r => {
      if (r.template !== tpl.id) return;
      const key = tpl.categoryField || 'category';
      const v = r.fields[key];
      if (v) set[v] = true;
    });
    sel.innerHTML = '<option value="">全部' + ((tpl.fields.find(f => f.key === tpl.categoryField) || {}).label || '分类') + '</option>' +
      Object.keys(set).map(v => '<option value="' + v + '">' + v + '</option>').join('');
    if (set[keep]) sel.value = keep;
  }

  /* ---------- 统计与图表 ---------- */
  function renderMetrics(list) {
    const nf = metricField();
    const nl = metricLabel();
    const nums = list.map(r => parseFloat(r.fields[nf])).filter(n => !isNaN(n));
    const sum = nums.reduce((a, b) => a + b, 0);
    const avg = nums.length ? sum / nums.length : null;
    const max = nums.length ? Math.max.apply(null, nums) : null;
    const min = nums.length ? Math.min.apply(null, nums) : null;
    const items = [
      ['记录数', list.length + ' 条'],
      [nl + '合计', fmt(nums.length ? sum : null)],
      [nl + '平均', fmt(avg)],
      ['最大值', fmt(max)],
      ['最小值', fmt(min)]
    ];
    $('metrics').innerHTML = items.map(i => '<div class="metric"><div class="k">' + i[0] + '</div><div class="v">' + i[1] + '</div></div>').join('');
  }

  function groupBy(list, keyFn, numericField, agg) {
    const map = {};
    list.forEach(r => {
      const k = keyFn(r) || '未填写';
      const v = parseFloat(r.fields[numericField]);
      if (!map[k]) map[k] = { sum: 0, count: 0 };
      if (!isNaN(v)) { map[k].sum += v; map[k].count++; }
    });
    return Object.keys(map).map(k => ({
      key: k,
      sum: map[k].sum,
      count: map[k].count,
      avg: map[k].count ? map[k].sum / map[k].count : 0,
      value: agg === 'avg' ? (map[k].count ? map[k].sum / map[k].count : 0) : map[k].sum
    }));
  }

  const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];

  function drawChart(id, config) {
    if (!window.Chart) return;
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = $(id);
    if (!el) return;
    charts[id] = new Chart(el.getContext('2d'), config);
  }

  function renderCharts(list) {
    const tpl = currentTpl();
    const nf = metricField();
    const nl = metricLabel();
    const agg = tpl.agg || 'sum';
    $('chartEmpty').hidden = list.length > 0;

    if (!list.length || !window.Chart) {
      Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
      return;
    }

    // 趋势：按日期聚合；口径可切换（每日条数 / 数值合计）
    const trend = groupBy(list, r => (r.fields[tpl.dateField] || '').slice(0, 10) || new Date(r.createdAt).toISOString().slice(0, 10), nf, agg);
    trend.sort((a, b) => a.key < b.key ? -1 : 1);
    const mode = $('trendMode') ? $('trendMode').value : 'count';
    drawChart('chartTrend', {
      type: 'line',
      data: {
        labels: trend.map(t => t.key),
        datasets: [{
          label: mode === 'count' ? '记录条数' : nl + (agg === 'avg' ? '（平均）' : '（合计）'),
          data: trend.map(t => Math.round((mode === 'count' ? t.count : t.value) * 100) / 100),
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37,99,235,.12)',
          tension: .3, fill: true, pointRadius: 3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    // 构成占比：有分类字段按分类，没有则按月份
    $('pieTitle').textContent = tpl.categoryField ? '分类构成' : '月度构成';
    const cat = groupBy(list, r => tpl.categoryField ? r.fields[tpl.categoryField] : (r.fields[tpl.dateField] || '').slice(0, 7), nf, agg);
    cat.sort((a, b) => b.sum - a.sum);
    const top = cat.slice(0, 8);
    if (cat.length > 8) {
      const rest = cat.slice(8);
      top.push({ key: '其他', sum: rest.reduce((a, b) => a + b.sum, 0), value: rest.reduce((a, b) => a + b.value, 0) });
    }
    drawChart('chartPie', {
      type: 'doughnut',
      data: {
        labels: top.map(t => t.key),
        datasets: [{ data: top.map(t => Math.round(t.value * 100) / 100), backgroundColor: PALETTE }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });

    // 排行
    const rank = groupBy(list, r => r.fields[tpl.labelField], nf, agg);
    rank.sort((a, b) => b.value - a.value);
    const top10 = rank.slice(0, 10);
    drawChart('chartRank', {
      type: 'bar',
      data: {
        labels: top10.map(t => t.key),
        datasets: [{
          label: nl + (agg === 'avg' ? '（平均）' : '（合计）'),
          data: top10.map(t => Math.round(t.value * 100) / 100),
          backgroundColor: '#2563eb', borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } }
      }
    });
  }

  function renderAll() {
    renderCategoryFilter();
    const list = renderRecords();
    renderMetrics(list);
    renderCharts(list);
  }

  /* ---------- 导入导出 ---------- */
  function exportCsv() {
    const tpl = currentTpl();
    const list = S.filter({
      template: tpl.id,
      dateFrom: $('fDateFrom').value, dateTo: $('fDateTo').value,
      category: $('fCategory').value, categoryKey: tpl.categoryField, keyword: $('fKeyword').value
    });
    if (!list.length) return toast('当前没有可导出的数据');
    S.download('统计导出_' + tpl.name + '_' + new Date().toISOString().slice(0, 10) + '.csv', S.toCsv(list), 'text/csv;charset=utf-8');
    toast('已导出 ' + list.length + ' 条');
  }

  function exportJson() {
    if (!S.records.length) return toast('当前没有数据');
    S.download('统计备份_' + new Date().toISOString().slice(0, 10) + '.json', S.toJson(), 'application/json');
    toast('备份文件已导出');
  }

  function importJson(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const list = S.fromJson(fr.result);
        if (!confirm('将导入 ' + list.length + ' 条记录，并覆盖当前全部数据。是否继续？')) return;
        S.replaceAll(list);
        renderAll();
        toast('已导入 ' + list.length + ' 条记录');
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    };
    fr.readAsText(file);
  }

  /* ---------- 设置 ---------- */
  function openSettings() {
    const s = S.settings;
    $('aiPreset').value = s.aiPreset || 'custom';
    $('aiBase').value = s.aiBase || '';
    $('aiModel').value = s.aiModel || '';
    $('aiKey').value = s.aiKey || '';
    $('ocrLang').value = s.ocrLang || 'chi_sim+eng';
    $('ocrLangPath').value = s.ocrLangPath || '';
    $('settingsModal').hidden = false;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    const dz = $('dropzone');
    dz.onclick = () => $('filePicker').click();
    $('filePicker').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { addFiles(e.dataTransfer.files); });
    document.addEventListener('paste', e => {
      if (!e.clipboardData) return;
      addFiles(e.clipboardData.files);
    });

    $('btnClearQueue').onclick = () => { queue = []; renderPreviews(); };
    $('btnRun').onclick = runQueue;
    $('btnSaveDrafts').onclick = saveDrafts;
    $('btnDropDrafts').onclick = () => { if (confirm('丢弃当前识别结果？')) { drafts = []; renderDrafts(); } };

    $('engineSelect').onchange = e => {
      S.saveSettings({ engine: e.target.value });
      updateEngineBadge();
    };
    $('engineSelect').value = S.settings.engine;
    updateEngineBadge();

    $('trendMode').onchange = renderAll;
    $('metricSelect').onchange = renderAll;

    ['fDateFrom', 'fDateTo', 'fCategory', 'fKeyword'].forEach(id => {
      $(id).addEventListener('input', renderAll);
      $(id).addEventListener('change', renderAll);
    });
    $('btnResetFilter').onclick = () => {
      $('fDateFrom').value = ''; $('fDateTo').value = ''; $('fCategory').value = ''; $('fKeyword').value = '';
      renderAll();
    };

    $('btnExportCsv').onclick = exportCsv;
    $('btnExportJson').onclick = exportJson;
    $('btnImport').onclick = () => $('fileImport').click();
    $('fileImport').onchange = e => {
      if (e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    };
    $('btnClearAll').onclick = () => {
      if (!S.records.length) return toast('当前没有数据');
      if (confirm('确定清空全部 ' + S.records.length + ' 条记录？该操作不可恢复，建议先导出 JSON 备份。')) {
        S.clearAll(); renderAll(); toast('已清空');
      }
    };

    $('btnSettings').onclick = openSettings;
    $('btnCloseSettings').onclick = () => { $('settingsModal').hidden = true; };
    $('settingsModal').onclick = e => { if (e.target === $('settingsModal')) $('settingsModal').hidden = true; };
    $('aiPreset').onchange = e => {
      const p = window.AI_PRESETS[e.target.value];
      if (p) { $('aiBase').value = p.base; $('aiModel').value = p.model; }
    };
    $('btnSaveSettings').onclick = () => {
      S.saveSettings({
        aiPreset: $('aiPreset').value,
        aiBase: $('aiBase').value.trim(),
        aiModel: $('aiModel').value.trim(),
        aiKey: $('aiKey').value.trim(),
        ocrLang: $('ocrLang').value,
        ocrLangPath: $('ocrLangPath').value.trim()
      });
      $('settingsModal').hidden = true;
      toast('设置已保存');
    };
  }

  function updateEngineBadge() {
    const v = $('engineSelect').value;
    $('engineBadge').textContent = '识别引擎：' + (v === 'ai' ? 'AI 视觉' : '本地 OCR');
  }

  /* ---------- CDN 兜底 ---------- */
  function ensureLibs() {
    const fallback = [
      ['Tesseract', 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'],
      ['Chart', 'https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js']
    ];
    fallback.forEach(([name, url]) => {
      if (window[name]) return;
      const s = document.createElement('script');
      s.src = url;
      s.onerror = () => console.warn('无法加载 ' + name + '：' + url);
      document.head.appendChild(s);
    });
  }

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    ensureLibs();
    initTemplates();
    bind();
    renderPreviews();
    renderAll();
  });
})();
