/* 识别抽取：本地 OCR（Tesseract.js）+ 规则解析，或 AI 视觉大模型结构化抽取 */
window.AI_PRESETS = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  glm:    { base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6v-flash' },
  qwen:   { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' }
};

window.Extract = (function () {

  /* ============ 通用工具 ============ */

  // 全角数字/符号转半角
  function normalize(s) {
    return String(s)
      .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[．。]/g, '.')
      .replace(/[，]/g, ',')
      .replace(/[：]/g, ':')
      .replace(/[－—–]/g, '-')
      .replace(/[￥¥]/g, 'Y');
  }

  function toNumber(v) {
    if (v == null) return null;
    let s = normalize(v).replace(/[,，\s]/g, '');
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return isNaN(n) ? null : n;
  }

  function lines(text) {
    return String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }

  const AMOUNT_RE = /-?\d[\d,]*(\.\d{1,2})?/g;

  function numbersIn(s) {
    const out = [];
    const m = normalize(s).match(AMOUNT_RE);
    if (m) m.forEach(x => { const n = toNumber(x); if (n != null) out.push(n); });
    return out;
  }

  function validYmd(y, mo, d) {
    const Y = +y, M = +mo, D = +d;
    return Y >= 1900 && Y <= 2200 && M >= 1 && M <= 12 && D >= 1 && D <= 31;
  }

  // 从文件名提取日期：Screenshot_2026-03-09-16-30-00、IMG_20260309_1200 等
  function dateFromFilename(name) {
    const m = String(name).match(/(?:^|[^\d])(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[^\d]|$)/);
    if (m && validYmd(m[1], m[2], m[3])) return pad(m[1], m[2], m[3]);
    return '';
  }

  function findDate(text) {
    const t = normalize(text);
    let m = t.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m && validYmd(m[1], m[2], m[3])) return pad(m[1], m[2], m[3]);
    m = t.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m && validYmd(m[1], m[2], m[3])) return pad(m[1], m[2], m[3]);
    // 只有"月/日"时补当前年份；分隔符排除小数点，避免把 25.00 当成日期
    m = t.match(/(?:^|[^\d.])(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?(?![\d.])/);
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
      return pad(new Date().getFullYear(), m[1], m[2]);
    }
    return '';
  }
  function pad(y, mo, d) {
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function pick(list, keywords) {
    for (const line of list) {
      for (const k of keywords) {
        if (line.indexOf(k) !== -1) return line;
      }
    }
    return '';
  }

  function after(line, keywords) {
    const idx = (() => {
      for (const k of keywords) { const i = line.indexOf(k); if (i !== -1) return i + k.length; }
      return -1;
    })();
    if (idx === -1) return '';
    return line.slice(idx).replace(/^[:：\s]+/, '');
  }

  function matchAny(s, keywords) {
    return keywords.some(k => s.indexOf(k) !== -1);
  }

  /* ============ 各模板的 OCR 文本解析 ============ */

  function parseReceipt(text) {
    const ls = lines(text);
    const f = { date: '', merchant: '', amount: '', category: '', invoiceNo: '' };

    f.date = findDate(text);

    // 金额：优先取"合计/总计/应付/实付/金额"那一行里的数字
    let amtLine = pick(ls, ['合计', '总计', '应付', '实付', '应收', '小写', '总价', '总额', '共计', 'Amount', 'TOTAL']);
    let nums = amtLine ? numbersIn(amtLine) : [];
    if (!nums.length) {
      // 次选：带货币符号的数字
      const yLine = pick(ls, ['Y', '$']);
      if (yLine) nums = numbersIn(yLine);
    }
    if (!nums.length) {
      // 兜底：所有带两位的数里取最大
      const all = [];
      ls.forEach(l => numbersIn(l).forEach(n => { if (/\.\d{2}$/.test(String(n))) all.push(n); }));
      nums = all.length ? [Math.max.apply(null, all)] : [];
    }
    if (nums.length) f.amount = Math.max.apply(null, nums);

    // 商家：前 8 行里挑含中文且数字占比低的最长行
    const head = ls.slice(0, 8);
    let best = '', bestScore = -1;
    head.forEach(l => {
      if (/^[\d\s.,:：\-/]+$/.test(l)) return;
      if (matchAny(l, ['发票', '收据', '小票', '欢迎光临', '谢谢', '合计', '总计', '电话', '地址'])) return;
      const cjk = (l.match(/[\u4e00-\u9fa5]/g) || []).length;
      if (cjk < 2) return;
      if (cjk > bestScore) { bestScore = cjk; best = l; }
    });
    f.merchant = best.replace(/[:：].*$/, '').trim();

    // 票号
    const noM = normalize(text).match(/(?:发票号码|发票号|票号|号码|No\.?|NO\.?)\s*[:：]?\s*([0-9A-Za-z]{6,25})/);
    if (noM) f.invoiceNo = noM[1];

    // 分类猜测
    const kw = [
      ['餐饮', ['餐饮', '饭店', '餐厅', '美食', '咖啡', '茶', '食品', '食堂', '外卖']],
      ['交通', ['加油', '石油', '出租', '地铁', '高铁', '铁路', '航空', '客运', '停车', 'ETC']],
      ['办公', ['办公', '文具', '印刷', '打印', '电脑', '数码']],
      ['采购', ['超市', '商城', '百货', '批发', '建材', '五金']],
      ['差旅', ['酒店', '宾馆', '住宿', '旅行', '旅行社']]
    ];
    f.category = '其他';
    for (const [cat, keys] of kw) {
      if (matchAny(text, keys)) { f.category = cat; break; }
    }
    return [f];
  }

  // 只去掉行尾的 N 个数字（数量/单价/金额），避免误删"名称"里的数字（如 A4打印纸）
  function stripTrailingNumbers(s, count) {
    let out = s;
    for (let i = 0; i < count; i++) {
      out = out.replace(/[\s:：]*-?\d[\d,]*(\.\d+)?\s*$/, '');
    }
    return out.replace(/^\d{1,3}[.、)）\s]+/, '').replace(/[:：\s]+$/, '').trim();
  }

  function parseChecklist(text) {
    const ls = lines(text);
    const date = findDate(text);
    const rows = [];
    ls.forEach(raw => {
      let l = normalize(raw);
      if (matchAny(l, ['名称', '数量', '单价', '金额', '合计', '小计', '总计', '序号', '备注', '品名'])) return;
      const nums = numbersIn(l);
      if (!nums.length) return;
      const name = stripTrailingNumbers(l, nums.length);
      if (!name) return;
      const f = { date, name, qty: '', price: '', amount: '', category: '', note: '' };
      if (nums.length >= 3) { f.qty = nums[nums.length - 3]; f.price = nums[nums.length - 2]; f.amount = nums[nums.length - 1]; }
      else if (nums.length === 2) {
        f.qty = nums[0]; f.amount = nums[1];
        f.price = f.qty ? Math.round((f.amount / f.qty) * 100) / 100 : '';
      } else { f.qty = 1; f.amount = nums[0]; f.price = f.amount; }
      rows.push(f);
    });
    return rows.length ? rows : [{ date, name: '', qty: '', price: '', amount: '', category: '', note: '' }];
  }

  function parseMeter(text) {
    const ls = lines(text);
    const f = { date: '', device: '', reading: '', unit: '', usage: '', note: '' };
    f.date = findDate(text);

    const rLine = pick(ls, ['读数', '示数', '指数', '表底', '当前', '止码', '本次', 'kWh', 'm3', 'm³']);
    let nums = rLine ? numbersIn(rLine) : [];
    if (!nums.length) {
      const all = [];
      ls.forEach(l => numbersIn(l).forEach(n => all.push(n)));
      if (all.length) nums = [Math.max.apply(null, all)];
    }
    if (nums.length) f.reading = nums[nums.length - 1];

    const dLine = pick(ls, ['表号', '设备号', '设备', '户号', '编号', '表具']);
    if (dLine) f.device = after(dLine, ['表号', '设备号', '设备', '户号', '编号', '表具']).replace(/[:：]\s*/, '').trim();
    if (!f.device) {
      const m = normalize(text).match(/(?:表号|户号|No\.?)\s*[:：]?\s*([0-9A-Za-z-]{4,20})/);
      if (m) f.device = m[1];
    }

    if (/kWh|KW·H|度/i.test(text)) f.unit = 'kWh';
    else if (/m³|m3|立方米|方/i.test(text)) f.unit = 'm³';
    else if (/吨/i.test(text)) f.unit = '吨';
    else if (/kg|公斤/i.test(text)) f.unit = 'kg';

    const uLine = pick(ls, ['用量', '本期用量', '实用', '用量']);
    if (uLine) { const n = numbersIn(uLine); if (n.length) f.usage = n[0]; }
    return [f];
  }

  function parseScore(text) {
    const ls = lines(text);
    const date = findDate(text);
    // 表头里的统一科目/班级
    let globalSubject = '';
    const sLine = pick(ls, ['科目']);
    if (sLine) globalSubject = after(sLine, ['科目']).replace(/[:：]\s*/, '').trim().slice(0, 10);
    let globalClass = '';
    const cLine = pick(ls, ['班级', '班次']);
    if (cLine) globalClass = after(cLine, ['班级', '班次']).replace(/[:：]\s*/, '').trim().slice(0, 10);

    const rows = [];
    ls.forEach(raw => {
      if (matchAny(raw, ['姓名', '科目', '成绩', '分数', '班级', '学号', '序号', '合计', '平均'])) return;
      const l = normalize(raw);
      const m = l.match(/^([\u4e00-\u9fa5·]{2,6}|[A-Za-z][A-Za-z\s.]{1,20}?)\s+(\d{1,3}(?:\.\d)?)\s*(?:分)?$/);
      if (!m) return;
      const score = parseFloat(m[2]);
      if (score < 0 || score > 200) return;
      const name = m[1].trim();
      let subject = globalSubject;
      if (!subject) {
        const found = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'].filter(s => l.indexOf(s) !== -1);
        if (found.length) subject = found[0];
      }
      rows.push({ date, name, subject, score, class: globalClass, note: '' });
    });

    if (!rows.length) {
      // 兜底：只抽出 0-150 的分数，姓名留空
      const nums = [];
      ls.forEach(l => numbersIn(l).forEach(n => { if (n >= 0 && n <= 150) nums.push(n); }));
      if (nums.length) return [{ date, name: '', subject: globalSubject, score: nums[nums.length - 1], class: globalClass, note: '' }];
    }
    return rows.length ? rows : [{ date, name: '', subject: '', score: '', class: '', note: '' }];
  }

  const PARSERS = { receipt: parseReceipt, checklist: parseChecklist, meter: parseMeter, score: parseScore };

  /* ============ Tesseract 本地 OCR ============ */

  let workerPromise = null;
  let workerLang = '';

  function ensureWorker(lang, langPath, logger) {
    if (workerPromise && workerLang === lang) return workerPromise;
    if (workerPromise) {
      workerPromise.then(w => w.terminate().catch(() => {}));
      workerPromise = null;
    }
    if (!window.Tesseract) return Promise.reject(new Error('OCR 引擎未加载，请检查网络（页面依赖 CDN 上的 tesseract.js）'));
    const opts = { logger: logger || function () {} };
    if (langPath) opts.langPath = langPath.replace(/\/+$/, '');
    workerLang = lang;
    workerPromise = window.Tesseract.createWorker(lang, 1, opts).then(w => {
      // 表格类数据按"稀疏文本"识别更稳
      if (/chi|eng|jpn/.test(lang)) {
        return w.setParameters({ preserve_interword_spaces: '1' }).then(() => w, () => w);
      }
      return w;
    });
    return workerPromise;
  }

  // 小图放大，能明显改善识别率
  function upscale(dataUrl, minDim, maxDim) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const maxSide = Math.max(img.width, img.height);
        let scale = maxSide < minDim ? minDim / maxSide : 1;
        if (maxSide * scale > maxDim) scale = maxDim / maxSide;
        if (scale === 1) return resolve(dataUrl);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function ocrText(dataUrl, cfg, onProgress) {
    const lang = (cfg.ocrLang || 'chi_sim+eng');
    return ensureWorker(lang, cfg.ocrLangPath, m => {
      if (onProgress && m.status) onProgress(m.status, m.progress || 0);
    }).then(async w => {
      const src = await upscale(dataUrl, 1400, 2600);
      const { data } = await w.recognize(src);
      return data && data.text ? data.text : '';
    });
  }

  /* ============ AI 视觉抽取 ============ */

  function buildPrompt(tpl) {
    const desc = tpl.fields.map(f => {
      let d = '- "' + f.key + '"：' + f.label;
      if (f.type === 'number') d += '（必须是数字，不带单位/货币符号）';
      if (f.type === 'date') d += '（格式 YYYY-MM-DD）';
      if (f.options) d += '（只能从这些取值：' + f.options.join(' / ') + '）';
      return d;
    }).join('\n');
    return [
      '你是数据录入助手。请识别这张「' + tpl.name + '」照片，把信息提取成 JSON 数组。',
      '图片里有几条记录，数组就有几个对象；只有一条也要包成数组。',
      '字段定义：\n' + desc,
      '要求：',
      '1. 只输出 JSON，不要输出解释、不要加 markdown 代码块标记。',
      '2. 识别不到的字段填空字符串 ""，不要编造。',
      '3. 日期统一成 YYYY-MM-DD。'
    ].join('\n');
  }

  function extractJson(raw) {
    let s = String(raw).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = s.indexOf('[');
    const startObj = s.indexOf('{');
    let arr;
    try {
      arr = JSON.parse(s);
    } catch (e) {
      const from = (start !== -1 && (startObj === -1 || start < startObj)) ? start : startObj;
      if (from === -1) throw new Error('模型未返回可解析的 JSON：' + s.slice(0, 120));
      let end = s.lastIndexOf(s[from] === '[' ? ']' : '}');
      arr = JSON.parse(s.slice(from, end + 1));
    }
    return Array.isArray(arr) ? arr : [arr];
  }

  function aiExtract(dataUrl, tpl, cfg) {
    if (!cfg.aiBase || !cfg.aiKey || !cfg.aiModel) {
      return Promise.reject(new Error('AI 识别需要先在「设置」里填写 API Base URL、模型和 Key'));
    }
    const url = cfg.aiBase.replace(/\/+$/, '') + '/chat/completions';
    const body = {
      model: cfg.aiModel,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(tpl) },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    };
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.aiKey },
      body: JSON.stringify(body)
    }).then(async res => {
      const text = await res.text();
      if (!res.ok) throw new Error('接口返回 ' + res.status + '：' + text.slice(0, 200));
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error('接口返回非 JSON：' + text.slice(0, 200)); }
      const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      if (!content) throw new Error('接口未返回内容：' + text.slice(0, 200));
      return extractJson(content);
    }).then(rows => rows.map(r => {
      const f = {};
      tpl.fields.forEach(fd => {
        let v = r[fd.key];
        if (v == null) v = '';
        if (fd.type === 'number') { const n = toNumber(v); v = n == null ? '' : n; }
        if (fd.options && fd.options.indexOf(String(v)) === -1) v = '';
        f[fd.key] = v;
      });
      return f;
    }));
  }

  /* ============ 统一入口 ============ */

  function run(file, tpl, engine, cfg, onProgress) {
    const parse = PARSERS[tpl.id] || parseReceipt;
    return Promise.resolve()
      .then(() => new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('读取图片失败'));
        fr.readAsDataURL(file);
      }))
      .then(dataUrl => {
        if (engine === 'ai') return aiExtract(dataUrl, tpl, cfg).then(rows => ({ rows, dataUrl }));
        return ocrText(dataUrl, cfg, onProgress)
          .then(text => ({ rows: parse(normalize(text)), dataUrl, text }));
      })
      .then(r => {
        if (!r.rows.length) r.rows = [window.emptyFields(tpl)];
        // 日期兜底：图片内容里没识别到日期时，用文件名里的日期（如 Screenshot_2026-03-09-...），
        // 避免全部落到入库时间、导致所有记录挤在同一天
        const fb = dateFromFilename(file.name);
        if (fb) {
          r.rows.forEach(row => { if (!row[tpl.dateField]) row[tpl.dateField] = fb; });
        }
        return r;
      });
  }

  return { run, ocrText, aiExtract, dateFromFilename, parse: (t, id) => (PARSERS[id] || parseReceipt)(normalize(t)) };
})();
