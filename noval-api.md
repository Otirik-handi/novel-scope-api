# 小说网站数据接口清单

来源：`../oh-story-claudecode/skills/story-long-scan` 的采集脚本。

> 说明：以下多数为网站页面、SSR 页面状态或浏览器页内请求，并非网站承诺稳定的公开 JSON API。使用时应遵守目标网站的服务条款、robots 规则和访问频率限制。

## 起点中文网

### 榜单页面

- 移动端 SSR：`GET https://m.qidian.com/rank/{type}/`
- 三江推荐：`GET https://m.qidian.com/sanjiang/`
- PC 备用页面：`GET https://www.qidian.com/rank/{type}/`
- PC 三江推荐：`GET https://www.qidian.com/sanjiang/`

移动端页面 HTML 中的 `script#vite-plugin-ssr_pageContext` 含 JSON 数据。采集脚本读取：

- `pageContext.pageContext.pageProps.pageData.records`
- 常用字段：`bName`、`bid`、`bAuth`、`cat`、`subCat`、`desc`、`cnt`、`rankCnt`

`{type}` 的移动端路径如下：

| 脚本榜单标识 | 实际移动端路径 | 说明 |
| --- | --- | --- |
| `hotsales` | `/rank/hotsales/` | 畅销榜 |
| `yuepiao` | `/rank/yuepiao/` | 月票榜 |
| `signnewbook` | `/rank/sign/` | 签约榜 |
| `pubnewbook` | `/rank/newbook/` | 新书榜 |
| `newauthor` | `/rank/newauthor/` | 新人榜 |
| `newsign` | `/rank/sign/` | 使用签约榜替代 |
| `recom` | `/rank/rec/` | 推荐榜 |
| `readindex` | `/rank/readindex/` | 阅读指数榜 |
| `collect` | `/rank/newfans/` | 使用书友榜替代 |

### 作品详情页

- `GET https://m.qidian.com/book/{bid}/`

## 番茄小说

### 榜单页面

- `GET https://fanqienovel.com/rank/{channel}_{type}_{categoryId}`

参数：

| 参数 | 含义 | 脚本默认值 |
| --- | --- | --- |
| `channel` | 频道 | `1` 男频，`0` 女频 |
| `type` | 榜单类型 | `2` 阅读榜，`1` 新书榜 |
| `categoryId` | 分类 ID | 男频入口 `1141`，女频入口 `1139` |

数据来自浏览器页内的 `window.__INITIAL_STATE__`，脚本从其中的榜单列表提取 `bookId`、`read_count`、`wordNumber`、`creationStatus`、`lastChapterTitle`、`category` 等字段。

### 作品详情页

- `GET https://fanqienovel.com/page/{bookId}`
- 脚本在已打开的番茄页面同源发起：`GET /page/{bookId}`

详情 HTML 内嵌数据可提取：`bookName`、`author` 或 `authorName`、`abstract`、`categoryV2`、标签信息。

## 晋江文学城

### 榜单页面

- `GET https://www.jjwxc.net/topten.php?orderstr={rankType}&t={channel}`

参数：

| 参数 | 含义 | 可用值 |
| --- | --- | --- |
| `orderstr` | 榜单类型 | `12` 收入金榜、`7` 月榜、`8` 季榜、`14` 完结金榜、`15` 新手金榜、`17` 千字金榜 |
| `t` | 频道 | `0` 为全站；其他值由站点频道定义 |

榜单页面链接携带 `novelid`，用于请求作品详情。

### 作品详情页

- `GET https://www.jjwxc.net/onebook.php?novelid={novelId}`

页面使用 `gb18030` 编码。脚本通过 HTML 的 `itemprop` 提取：

- `collectedCount`
- `nutritionCount`
- `scoreCount`
- `reviewCount`
- `wordCount`
- `updataStatus`

## 七猫小说

### 榜单页面

- `GET https://www.qimao.com/paihang`

榜单类型由页面 Tab 切换，不存在脚本中已确认的独立榜单 URL 或 JSON 接口。

- 频道：男频、女频
- 榜单：大热、新书、完结、收藏、更新

脚本在浏览器加载并切换 Tab 后，从页面文本和链接中提取排名、书名、作者、分类、状态、字数、简介、更新和热度。

### 作品详情页

- `GET https://www.qimao.com/shuku/{bookId}/`

## 刺猬猫阅读

### 榜单页面

- `GET https://www.ciweimao.com/rank-index`

此单页包含多个榜单区块，脚本未发现单独的榜单 JSON 接口。

- 点击榜
- 收藏榜
- 推荐榜
- 订阅榜
- 月票榜
- 吐槽榜
- 新书榜
- 刀片榜
- 更新榜

### 作品详情页

- `GET https://www.ciweimao.com/book/{bookId}`

## 脚本来源

- `skills/story-long-scan/scripts/qidian-rank-scraper.js`
- `skills/story-long-scan/scripts/fanqie-rank-scraper.js`
- `skills/story-long-scan/scripts/jjwxc-rank-scraper.js`
- `skills/story-long-scan/scripts/qimao-rank-scraper.js`
- `skills/story-long-scan/scripts/ciweimao-rank-scraper.js`
