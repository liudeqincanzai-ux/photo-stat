# 照片数据自动拾取统计台

上传照片 → 自动识别字段 → 人工校对 → 入库统计。纯静态站点，可部署在 GitHub Pages，无需服务器和数据库。

## 使用流程

1. 选择**数据模板**（票据 / 纸质表格 / 仪表读数 / 成绩单 / 创作者周报）

   **创作者周报（小红书）**：一张截图 = 一条周记录，字段为 日期 / 本周观看 / 本周获赞 / 本周涨粉 / 最热笔记及其数据。看板顶部可切换统计指标（观看 / 获赞 / 涨粉）；日期优先取图片内容，其次取文件名里的日期（如 `Screenshot_2026-03-09-...` → `2026-03-09`）
2. 选择**识别引擎**，拖入或粘贴照片，点「开始识别」
3. 在「校对识别结果」表格里修正识别错的字，点「全部入库」
4. 「统计看板」自动出指标与图表；「数据明细」支持日期 / 分类 / 关键词筛选，可导出 CSV

## 两种识别引擎

| 引擎 | 说明 |
| --- | --- |
| 本地 OCR | 基于 Tesseract.js，在浏览器本地运行，**照片不上传任何服务器**，完全免费。中文印刷体效果尚可，手写体和复杂版式准确率有限，必须人工校对 |
| AI 视觉识别 | 调用视觉大模型直接输出结构化 JSON，准确率高、能理解版式。需要在「设置」里填 API Base URL / 模型 / Key |

### AI 引擎预设（已核实可用）

| 服务商 | Base URL | 模型 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.6v-flash`（免费，旧名 `glm-4v-flash` 仍可用） |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` |

任何 OpenAI 兼容接口都能用，选「自定义」自行填写即可。

**注意**：API Key 只存在你浏览器的 localStorage 里，本站没有后端、不会上传你的数据。但部分服务商的接口不允许浏览器直接跨域调用（CORS），若报网络错误请换一家或自行做服务端转发。

## 数据存储

- 数据保存在浏览器 localStorage（含压缩后的照片缩略图，约每张几十 KB）
- 换浏览器 / 清缓存会丢失，请定期用「导出 JSON」备份，用「导入」恢复
- 存储接近上限时会提示导出备份

## 部署到 GitHub Pages

已内置 GitHub Actions（`.github/workflows/pages.yml`）。步骤：

1. 在 GitHub 新建仓库，把本目录内容推上去
2. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**
3. 推送到 `main` 分支即自动部署，Actions 页面会给出访问地址

本地预览：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

## 常见问题

**识别结果为空？** 本地 OCR 首次使用需要从 CDN 下载中文语言包（十几 MB），请等待进度条走完；若网络受限，可在「设置」里把 traineddata 地址换成可访问的镜像。

**想离线使用？** 把 `tesseract.js` 与 `chart.js` 下载到 `assets/vendor/`，再把 `index.html` 里的两个 CDN 地址改成本地路径即可。

## 文件结构

```
index.html            页面结构
assets/style.css      样式
assets/templates.js   四类数据模板的字段定义
assets/store.js       本地存储、筛选、CSV/JSON 导入导出
assets/extract.js     OCR 抽取 + 规则解析 + AI 视觉抽取
assets/app.js         界面交互与图表
```
