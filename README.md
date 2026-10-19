# 光影档案 · Cinematheque

一个**纯静态的影视资料库站点**。收海报、评分、演职员、技术规格与检索，不含任何影片文件或下载地址。

- 零依赖：只用 Node 内置模块，`npm install` 都不需要
- 构建一次，得到完整 `site/` 目录，丢到任何静态托管即可
- 深色影院风 / 浅色阅读风双主题，响应式，键盘可访问
- 61 条示例条目、10 个主题合集、82 个静态页面

---

## 快速开始

```bash
cd cinematheque

# 1. 构建（生成 site/ 目录）
npm run build

# 2. 本地预览（构建 + 起服务）
npm run preview
# 打开终端打印的 http://127.0.0.1:4173

# 3. 本地内容后台（另开一个终端，可选）
npm run admin
# 打开 http://127.0.0.1:4174
```

需要 Node 18 或更高版本。仓库里没有任何第三方依赖，所以**不需要 npm install**。

构建时会先校验 `data/`：`id` 重复、类型/年份/评分越界、合集引用不存在等错误会直接中止构建；示例域名、缺海报、空来源等只提示警告，不阻塞生成。

---

## 目录结构

```
cinematheque/
├─ data/
│  ├─ site.config.json   站名、导航、合集、页脚、首页文案
│  └─ movies.json        全部条目数据（改这里就是改内容）
├─ admin/                本地内容后台（HTML / CSS / JS）
├─ assets/
│  ├─ style.css          全部样式（颜色变量集中在文件顶部）
│  ├─ app.js             筛选、搜索、排序、收藏、主题切换
│  └─ favicon.svg
├─ src/
│  ├─ build.mjs          静态站点生成器
│  └─ validate.mjs       数据校验（构建与后台共用）
├─ scripts/
│  ├─ admin.mjs          本地内容后台服务
│  ├─ serve.mjs          本地预览服务器
│  └─ fetch-tmdb.mjs     可选的 TMDB 元数据补全
└─ site/                 构建产物（部署时上传这个目录）
```

---

## 本地内容后台

不想手改 JSON，可以启动自带的后台：

```bash
npm run admin
# 打开 http://127.0.0.1:4174
```

另开一个终端运行 `npm run preview`，后台顶部的「打开预览」就能看到重建后的站点。

- 顶部「影片库 / 批量导入 / 站点设置」切换栏目，每个栏目独占一页：影片库是列表加编辑区，批量导入按榜单成批补全，站点设置放站点级配置
- 「站点设置」可改站名、描述、站点 URL 和页脚栏目，保存后自动重建
- 保存前自动备份 `data/movies.json` 或 `data/site.config.json` 到 `data/.backups/`（各保留最近 20 份），再原子写入
- 保存后自动执行构建，站点立即更新；构建失败时数据仍已保存，错误会显示在后台
- 校验与构建共用同一套规则：重复 ID、缺片名、非法片源地址、错误的页脚链接等会被拒绝，不会写入文件
- 「TMDB 补全」按条目搜索并回填，Key 只存在当前浏览器的 `localStorage`，由本机后台转发
- 新建条目可一键生成 URL slug；片源只接受 `http(s)` 链接

### 站点与页脚

切到顶部的「站点设置」栏目，可编辑站名、英文名、标语、站点描述、站点 URL、子路径 base，以及页脚说明、版权文案、备案号和页脚栏目/链接。顶部或底部的保存按钮都会写入 `data/site.config.json` 并重建站点；「放弃修改」会重新读取磁盘上的配置。

**后台没有登录，只监听 `127.0.0.1`。** 不要做端口转发或把 4174 端口暴露到公网；它只适合在本机自己用。需要多人远程编辑时，应另行部署带鉴权的服务端。

### 批量导入

切到「批量导入」，选择电影或剧集、TMDB 榜单（热门 / 高分 / 正在上映等）、起始页和每批条数（50–500），填好 Key 后开始。首次建议先导入 200 条，确认构建速度和页面效果后再继续。

- 按榜单整页拉取，再逐条读取详情；自动按 TMDB ID 和「片名 + 年份」去重，已收录的会跳过
- 导入过程显示进度、日志和新增 / 跳过 / 失败计数；单条详情缺失会跳过，Key 失效、被限流或网络中断会中止，已获取的条目仍留在内存里可保存
- 正常完成后只写入一次 `data/movies.json` 并重建站点；取消或出错后可选择保存或放弃当前批次
- 保存成功后会记住该榜单下一批的起始页，下次打开自动带出；榜单到末尾时回到第 1 页
- 只补充元数据，不包含片源；片源仍需在影片库中逐条添加，且只能填写有权分发的地址
- 需要本机能访问 `api.themoviedb.org`。后台会自动使用 Windows 系统代理，也会读取 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量；需要指定时可用 `TMDB_PROXY=http://127.0.0.1:7897 npm run admin`，`TMDB_PROXY=off` 则强制直连。代理请求偶发失败会自动重试一次。Key 与影片库共用，只存在当前浏览器，由本机后台转发

---

## 日常改内容

### 加一部片子

编辑 `data/movies.json`，往 `movies` 数组里加一条：

```json
{
  "id": "your-movie-2024",
  "title": "中文片名",
  "originalTitle": "Original Title",
  "year": 2024,
  "type": "movie",
  "genres": ["剧情", "悬疑"],
  "runtime": 120,
  "rating": 8.2,
  "votes": 1500,
  "country": "中国大陆",
  "language": "汉语普通话",
  "directors": ["导演名"],
  "cast": ["主演一", "主演二"],
  "tagline": "一句台词",
  "overview": "两句话简介。",
  "quality": ["4K", "1080P"],
  "collections": ["mcu"],
  "added": "2026-10-20",
  "poster": "",
  "backdrop": "",
  "sources": []
}
```

- `id` 必须唯一，会成为 URL：`/movie/your-movie-2024.html`
- `type` 可选 `movie` / `series` / `concert`，决定它进哪个栏目
- `poster` 留空时会自动生成一张渐变占位海报，写上图片地址则显示真实海报
- 加完执行 `npm run build`；校验不通过时构建会退出并列出具体条目

### 改站点名字、导航、合集、页脚

编辑 `data/site.config.json`。`collections` 数组里加一项，就会自动多出一个合集页。

### 换配色

`assets/style.css` 顶部的 CSS 变量：

```css
:root {                  /* 深色主题 */
  --accent: #e6b35a;     /* 强调色 */
  --bg: #0b0b0d;         /* 背景 */
}
html[data-theme="light"] { --accent: #b4802a; }
```

---

## 用 TMDB 自动补全真实数据

示例条目的评分是演示用占位值。接上 TMDB 官方 API 后会自动换成真实评分、票数、简介、海报和背景图：

```bash
# Windows PowerShell
$env:TMDB_API_KEY="你的key"
npm run fetch:tmdb

# macOS / Linux
TMDB_API_KEY=你的key npm run fetch:tmdb

npm run build
```

Key 申请地址：https://www.themoviedb.org/settings/api （个人用途免费）

也可以不跑命令行：在本地内容后台的「TMDB 补全」里填入 Key，搜索条目后选择「填入当前条目」或「新建条目」，检查一遍再保存。Key 不会写入仓库。

**TMDB 不会一次性镜像全库。** TMDB 有上百万条作品，全量搬进这个静态站点既没有必要，也会触发 API 限流。想成批扩展片库时，用本地后台的「批量导入」按榜单分页收录；只想补某几部时，用「TMDB 补全」搜索后填入或新建。若只想给现有条目批量补齐信息，可以运行 `npm run fetch:tmdb`，它会逐条处理 `data/movies.json`。

脚本按「原名 + 年份」搜索，写入 `data/movies.json`，并自动限速避免触发 API 频率限制。使用 TMDB 数据请遵守其使用条款并署名。

---

## 部署

部署前先把 `data/site.config.json` 里的 `url` 改成真实域名（含 `https://`）——canonical、`og:url`、`sitemap.xml` 和 `robots.txt` 都由它生成；仍停留在 `example.com` 时构建会给出警告。

构建产物是纯静态文件，几种常用方式：

**Vercel / Netlify / Cloudflare Pages**

- 构建命令：`node src/build.mjs`
- 输出目录：`site`
- 本仓库默认忽略构建产物；若要让平台直接托管 `site/`，先移除 `.gitignore` 里的 `site/` 并提交

**Nginx**

```nginx
server {
  listen 80;
  server_name your-domain.com;
  root /var/www/cinematheque/site;
  index index.html;
  location / { try_files $uri $uri/ =404; }
  error_page 404 /404.html;
}
```

**飞牛 NAS（Docker Compose）**

仓库自带 `Dockerfile`、`docker-compose.yml` 和 `deploy/nginx.conf`，构建和静态托管都在容器里完成，NAS 上不需要安装 Node：

1. 先把 `data/site.config.json` 的 `url` 改成实际访问地址（例如 `http://192.168.10.6:8080`）；如果放在子路径，再设置 `base`
2. 在 fnOS 的 Docker Compose 里新建项目并指向本仓库，或 SSH 登录 NAS 后执行：

   ```bash
   git clone https://github.com/kaynai1/cinematheque.git
   cd cinematheque
   docker compose up -d --build
   ```

   私有仓库需要先在 NAS 上配置 GitHub 凭据或访问令牌
3. 浏览器打开 `http://NAS_IP:8080`；更新时执行 `git pull && docker compose up -d --build`
4. 容器里只有 `site/` 静态文件，不包含内容后台；不要把 4174 端口或 `admin/` 暴露到局域网/公网

**GitHub Pages**

移除 `.gitignore` 里的 `site/` 后，把构建产物推到 `gh-pages` 分支，或在 Pages 设置里选择对应目录。

### 如果部署在子路径

比如放在 `https://example.com/films/`，在 `data/site.config.json` 里设置：

```json
"base": "/films"
```

然后重新构建。所有链接和资源路径会自动加上前缀。

---

## 内置功能

| 功能 | 说明 |
| --- | --- |
| 筛选 | 按类型、题材、规格（4K/1080P/720P）组合筛选，状态同步到 URL，支持前进/后退 |
| 搜索 | 匹配片名、原名、**导演**、**演员**、题材；关键词同样写入地址栏 |
| 排序 | 最近收录 / 评分最高 / 年份新旧 / 片名 |
| 我的片单 | 收藏存进浏览器 `localStorage`，不上传服务器，可一键清空 |
| 明暗主题 | 默认跟随系统，右上角切换后记住选择，首屏无闪烁 |
| 进场动画 | 滚动淡入，带 2.5 秒兜底，JS 失效也不会白屏 |
| SEO | 每页独立 title/description、canonical、Open Graph、`sitemap.xml`、`robots.txt`、详情页 `JSON-LD` |
| 可访问性 | 跳转链接、`aria-*` 标注、键盘焦点样式、尊重 `prefers-reduced-motion` |

---

## 关于内容合规

数据里的 `sources` 字段默认为空数组，用于填写**你本人拥有版权或已获正式授权**的观看入口。

**请只填入你有权分发的地址。** 收录商业影片的未授权下载链接，无论站点归属如何，都构成侵权分发。站内已内置对应提示，`about.html` 的「版权声明」一节也写明了这一立场。

影片的片名、年份、演职员等属于公开的作品信息；海报图片的著作权归各权利人所有。

---

## 许可

代码 MIT。站点内容与图片由你自行负责。
