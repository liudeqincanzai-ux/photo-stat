/* 数据模板定义：每种照片类型对应一组字段与统计口径 */
window.TEMPLATES = {
  receipt: {
    id: 'receipt',
    name: '票据 / 小票 / 发票',
    numericField: 'amount',
    dateField: 'date',
    labelField: 'merchant',
    categoryField: 'category',
    numericLabel: '金额',
    fields: [
      { key: 'date',      label: '日期',       type: 'date' },
      { key: 'merchant',  label: '商家/开票方', type: 'text' },
      { key: 'amount',    label: '金额',       type: 'number' },
      { key: 'category',  label: '分类',       type: 'select', options: ['餐饮', '交通', '办公', '采购', '差旅', '其他'] },
      { key: 'invoiceNo', label: '票号',       type: 'text' }
    ]
  },

  checklist: {
    id: 'checklist',
    name: '纸质表格 / 清单',
    numericField: 'amount',
    dateField: 'date',
    labelField: 'name',
    categoryField: 'category',
    numericLabel: '金额',
    fields: [
      { key: 'date',     label: '日期',   type: 'date' },
      { key: 'name',     label: '名称',   type: 'text' },
      { key: 'qty',      label: '数量',   type: 'number' },
      { key: 'price',    label: '单价',   type: 'number' },
      { key: 'amount',   label: '金额',   type: 'number' },
      { key: 'category', label: '分类',   type: 'select', options: ['耗材', '设备', '食品', '日用', '其他'] },
      { key: 'note',     label: '备注',   type: 'text' }
    ]
  },

  meter: {
    id: 'meter',
    name: '仪表 / 数字读数',
    numericField: 'reading',
    dateField: 'date',
    labelField: 'device',
    categoryField: 'unit',
    numericLabel: '读数',
    agg: 'avg',
    fields: [
      { key: 'date',   label: '抄表日期', type: 'date' },
      { key: 'device', label: '设备/表号', type: 'text' },
      { key: 'reading', label: '读数',    type: 'number' },
      { key: 'unit',   label: '单位',     type: 'select', options: ['kWh', 'm³', '吨', '度', 'kg', '其他'] },
      { key: 'usage',  label: '用量',     type: 'number' },
      { key: 'note',   label: '备注',     type: 'text' }
    ]
  },

  score: {
    id: 'score',
    name: '成绩单 / 统计表',
    numericField: 'score',
    dateField: 'date',
    labelField: 'name',
    categoryField: 'subject',
    numericLabel: '成绩',
    agg: 'avg',
    fields: [
      { key: 'date',    label: '日期', type: 'date' },
      { key: 'name',    label: '姓名', type: 'text' },
      { key: 'subject', label: '科目', type: 'select', options: ['语文', '数学', '英语', '物理', '化学', '生物', '其他'] },
      { key: 'score',   label: '成绩', type: 'number' },
      { key: 'class',   label: '班级', type: 'text' },
      { key: 'note',    label: '备注', type: 'text' }
    ]
  },

  xhsweekly: {
    id: 'xhsweekly',
    name: '创作者周报（小红书）',
    numericField: 'views',
    numericLabel: '本周观看',
    dateField: 'date',
    labelField: 'hotNote',
    categoryField: null,
    agg: 'sum',
    numericOptions: [
      { key: 'views', label: '本周观看' },
      { key: 'likes', label: '本周获赞' },
      { key: 'fans', label: '本周涨粉' },
      { key: 'hotViews', label: '最热笔记·观看' }
    ],
    fields: [
      { key: 'date',        label: '日期',       type: 'date' },
      { key: 'views',       label: '本周观看',   type: 'number' },
      { key: 'likes',       label: '本周获赞',   type: 'number' },
      { key: 'fans',        label: '本周涨粉',   type: 'number' },
      { key: 'hotNote',     label: '最热笔记',   type: 'text' },
      { key: 'hotViews',    label: '笔记·观看',  type: 'number' },
      { key: 'hotLikes',    label: '笔记·点赞',  type: 'number' },
      { key: 'hotComments', label: '笔记·评论',  type: 'number' }
    ]
  }
};

window.TEMPLATE_ORDER = ['receipt', 'checklist', 'meter', 'score', 'xhsweekly'];

/* 取模板的默认字段集合（值为空串） */
window.emptyFields = function (tpl) {
  const o = {};
  tpl.fields.forEach(f => { o[f.key] = ''; });
  return o;
};
