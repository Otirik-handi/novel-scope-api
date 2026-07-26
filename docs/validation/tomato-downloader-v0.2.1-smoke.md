# NovelScope V0.2.1 TomatoNovelDownloader 真实冒烟记录

验证日期：2026-07-26（Asia/Shanghai）

## 环境

- NovelScope 分支：`feature/v0.2.1-tomato-downloads`
- TomatoNovelDownloader：`TomatoNovelDownloader-Win64-v2.4.13.exe`
- Downloader 地址：`http://127.0.0.1:18427`
- NovelScope 地址：`http://127.0.0.1:3101`
- 数据库：经过 `scripts/database-isolation.cjs` 身份门禁确认的 `TEST_DATABASE_URL`
- Downloader 和 NovelScope artifact 均使用独立 OS 临时目录
- Downloader 配置：official-api、TXT、关闭段评、关闭有声书、关闭交互格式选择

## 操作

通过 NovelScope 创建单章范围任务：

```http
POST /v1/books/fanqie/7069948840148732967/downloads
Content-Type: application/json

{
  "startChapter": 20,
  "endChapter": 20
}
```

轮询：

```http
GET /v1/downloads/ef19aa2a-5be1-4c33-9a7b-a901b7aba8fe
```

任务完成后下载并删除：

```http
GET    /v1/downloads/ef19aa2a-5be1-4c33-9a7b-a901b7aba8fe/file
DELETE /v1/downloads/ef19aa2a-5be1-4c33-9a7b-a901b7aba8fe
```

## 结果

| 项目 | 结果 |
| --- | --- |
| 任务状态 | `succeeded` |
| 范围 | 第 20 章至第 20 章 |
| API 记录大小 | 12,950 bytes |
| 实际下载大小 | 12,950 bytes |
| API SHA-256 | `5bd289f554728644b4241ceb81ed9bb26bf16e965a4daaf948ded1f0fba29815` |
| 下载文件 SHA-256 | `5bd289f554728644b4241ceb81ed9bb26bf16e965a4daaf948ded1f0fba29815` |
| 文本字符数 | 4,540 |
| 中文字符数 | 3,473 |
| 删除响应 | `204 No Content` |
| 删除后 NovelScope artifact | 不存在 |

该章节匿名网页验证时只返回约 200 字预览；本次通过 Release 和 NovelScope 接入获得 4,540 字符，能够证明返回的不是网页预览片段。记录不包含正文原文。

## 清理

- NovelScope 下载任务通过 DELETE 删除。
- NovelScope 管理的 TXT 已删除。
- 测试数据库中的孤立 smoke `Book` 已在数据库身份校验后删除。
- `3101` 和 `18427` 均已停止监听，两个后台进程已结束。
- OS 临时诊断目录未进入 Git，也不属于应用 artifact 目录。
