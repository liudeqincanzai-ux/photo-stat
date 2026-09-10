/* 本地数据层：localStorage 持久化 + 导入导出 */
window.Store = (function () {
  const KEY_RECORDS = 'photostat.records.v1';
  const KEY_SETTINGS = 'photostat.settings.v1';

  const DEFAULT_SETTINGS = {
    template: 'receipt',
    engine: 'ocr',
    ocrLang: 'chi_sim+eng',
    ocrLangPath: '',
    aiPreset: 'custom',
    aiBase: '',
    aiModel: '',
    aiKey: ''
  };

  let records = [];
  let settings = Object.assign({}, DEFAULT_SETTINGS);

  function load() {
    try {
      records = JSON.parse(localStorage.getItem(KEY_RECORDS) || '[]');
      if (!Array.isArray(records)) records = [];
    } catch (e) {
      records = [];
    }
    try {
      settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}'));
    } catch (e) {
      settings = Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function persistRecords() {
    try {
      localStorage.setItem(KEY_RECORDS, JSON.stringify(records));
      return true;
    } catch (e) {
      alert('浏览器本地存储已满，无法保存。请先导出 JSON 备份，然后删除部分记录或关闭"保存缩略图"。');
      return false;
    }
  }

  function persistSettings() {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
  }

  load();

  return {
    get records() { return records; },
    get settings() { return settings; },

    saveSettings(patch) {
      Object.assign(settings, patch);
      persistSettings();
    },

    addMany(list) {
      list.forEach(r => records.unshift(r));
      return persistRecords();
    },

    add(record) {
      records.unshift(record);
      return persistRecords();
    },

    update(id, fields) {
      const r = records.find(x => x.id === id);
      if (r) { r.fields = Object.assign({}, r.fields, fields); r.updatedAt = Date.now(); }
      return persistRecords();
    },

    remove(id) {
      records = records.filter(r => r.id !== id);
      return persistRecords();
    },

    clearAll() {
      records = [];
      return persistRecords();
    },

    replaceAll(list) {
      records = list;
      return persistRecords();
    },

    /* ---------- 筛选 ---------- */
    filter(opt) {
      const { dateFrom, dateTo, category, categoryKey, keyword, template } = opt || {};
      const kw = (keyword || '').trim().toLowerCase();
      return records.filter(r => {
        if (template && r.template !== template) return false;
        if (dateFrom || dateTo) {
          const d = (r.fields.date || '').slice(0, 10);
          if (!d) return false;
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
        }
        if (category && r.fields[categoryKey || 'category'] !== category) return false;
        if (kw) {
          const hay = Object.values(r.fields).join(' ').toLowerCase();
          if (hay.indexOf(kw) === -1) return false;
        }
        return true;
      });
    },

    /* ---------- 导出 ---------- */
    toCsv(list) {
      const tpls = [];
      (window.TEMPLATE_ORDER || []).forEach(id => {
        if (list.some(r => r.template === id)) tpls.push(window.TEMPLATES[id]);
      });
      const cols = [];
      tpls.forEach(t => t.fields.forEach(f => {
        if (!cols.some(c => c.key === f.key)) cols.push(f);
      }));

      const head = ['模板', '入库时间', ...cols.map(c => c.label)];
      const rows = list.map(r => {
        const base = [
          (window.TEMPLATES[r.template] || {}).name || r.template,
          new Date(r.createdAt).toLocaleString('zh-CN')
        ];
        return base.concat(cols.map(c => r.fields[c.key] == null ? '' : String(r.fields[c.key])));
      });

      const esc = v => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = [head].concat(rows).map(row => row.map(esc).join(',')).join('\r\n');
      return '\uFEFF' + csv;   // BOM，保证 Excel 打开不乱码
    },

    toJson() {
      return JSON.stringify({ version: 1, exportedAt: Date.now(), records }, null, 2);
    },

    fromJson(text) {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.records;
      if (!Array.isArray(list)) throw new Error('文件格式不正确：找不到 records 数组');
      return list;
    },

    /* ---------- 工具 ---------- */
    uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    download(filename, content, mime) {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    /* 压缩后的缩略图，避免撑爆 localStorage */
    makeThumb(file, maxSize) {
      return new Promise(resolve => {
        const max = maxSize || 720;
        const img = new Image();
        const fr = new FileReader();
        fr.onload = () => {
          img.onload = () => {
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            try {
              resolve(c.toDataURL('image/jpeg', 0.72));
            } catch (e) {
              resolve('');
            }
          };
          img.onerror = () => resolve('');
          img.src = fr.result;
        };
        fr.onerror = () => resolve('');
        fr.readAsDataURL(file);
      });
    }
  };
})();
