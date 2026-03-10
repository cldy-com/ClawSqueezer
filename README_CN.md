<p align="center">
  <img src="assets/logo.png" alt="ClawSqueezer" width="200">
</p>

<h1 align="center">🍋 ClawSqueezer</h1>

<p align="center">
  <strong><a href="https://github.com/openclaw/openclaw">OpenClaw</a> 过期内容清理插件</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cldy-com/clawsqueezer"><img src="https://img.shields.io/npm/v/@cldy-com/clawsqueezer" alt="npm"></a>
  <a href="https://github.com/cldy-com/ClawSqueezer/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"></a>
  <a href="https://github.com/openclaw/openclaw"><img src="https://img.shields.io/badge/OpenClaw-%3E%3D2026.3.7-orange" alt="openclaw"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README_CN.md">中文</a>
</p>

你的消息只占上下文的 3%。图片、工具结果和命令输出占了 86%。LLM 处理完之后，它们就是死重 —— 却一直占着上下文窗口，直到压缩触发。

ClawSqueezer 在每次 LLM 调用前自动清理过期的大体积内容。压缩触发频率降低 2-3 倍。

## 问题

来自生产环境的真实 OpenClaw 会话分析：

```
📄 工具结果 (160个)      65,000 tokens   42%  ← 文件读取、命令输出、网页抓取
📸 图片 (1张截图)        48,000 tokens   30%  ← 一张 base64 图片
🔧 工具调用参数 (160个)  18,000 tokens   12%  ← SSH命令、文件路径、参数
🤖 助手回复 (128条)      18,000 tokens   11%  ← LLM 的回复
💬 用户消息 (75条)        4,000 tokens    3%  ← 你说的话
🔩 开销                   4,000 tokens    2%  ← 工具ID、思考过程
──────────────────────────────────────────────
                        ~157K tokens 占满 200K 上下文窗口
```

那张图片是 20 轮之前看过的。那些文件读取已经处理完了。但它们还在上下文里吃 token，直到压缩触发一次昂贵的 LLM 调用来总结一切。

## 解决方案

`assemble()` 在每次 LLM 调用前运行，清理过期内容：

```
图片 (48K tokens，5轮前)
  → "[图片已处理 — 48,000 tokens，5轮前已处理]"
  → 释放 48K tokens

文件读取 (10K tokens，8轮前)
  → "[工具结果已压缩 — 原始 40,000 字符 — 预览: import { Router }...]"
  → 释放 9.5K tokens

命令输出 (5K tokens，6轮前)
  → "[exec: npm run build 2>&1]"
  → 释放 5K tokens
```

最近的内容永远不会被触碰。只有过期的大体积内容会被清理。

## 系统要求

- **OpenClaw >= 2026.3.7**（需要 ContextEngine 插件槽位）
- **Node.js >= 20**

插件会在启动时检查 OpenClaw 版本，版本过低会自动禁用。

## 安装

```bash
# 从 npm 安装
openclaw plugins install @cldy-com/clawsqueezer

# 从 GitHub 安装
openclaw plugins install https://github.com/cldy-com/ClawSqueezer

# 本地路径安装（开发用）
openclaw plugins install /path/to/ClawSqueezer --link
```

然后激活为上下文引擎：

```bash
openclaw config set plugins.slots.contextEngine clawsqueezer
```

或在 `openclaw.json` 中配置：

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "clawsqueezer"
    }
  }
}
```

### 配置选项

```json
{
  "plugins": {
    "config": {
      "clawsqueezer": {
        "staleTurns": 4,
        "minTokensToSqueeze": 200,
        "keepPreviewChars": 200,
        "imageAgeTurns": 2
      }
    }
  }
}
```

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `staleTurns` | `4` | 多少轮之后内容可以被清理 |
| `minTokensToSqueeze` | `200` | 最小 token 阈值，低于此值不清理 |
| `keepPreviewChars` | `200` | 清理后保留的预览字符数 |
| `imageAgeTurns` | `2` | 图片在多少轮后被清理（值越小越积极） |

### 回滚

出问题可以立即回滚：

```bash
# 软回滚 — 恢复默认，插件保留
openclaw config unset plugins.slots.contextEngine

# 中等 — 插件不加载
openclaw plugins disable clawsqueezer

# 硬回滚 — 完全删除
openclaw plugins uninstall clawsqueezer
```

无数据丢失。ClawSqueezer 仅在 `assemble()` 时修改内存中的消息 —— 不写入会话文件。

## 工作原理

```
消息到达 → OpenClaw 正常处理
                    │
                    ▼
             assemble() 在 LLM 调用前触发
                    │
                    ▼
         ┌──────────────────────┐
         │ 扫描消息寻找：       │
         │ • 过期图片           │
         │ • 过期工具结果       │
         │ • 过期命令输出       │
         │ • 大体积工具参数     │
         └──────────┬───────────┘
                    │
         替换为小型占位符
                    │
                    ▼
         LLM 看到精简上下文 → 更多空间工作
         压缩触发更少 → 省钱
```

### 会被清理的内容

| 内容类型 | 典型大小 | 清理后 | 何时清理 |
|---------|---------|--------|---------|
| Base64 图片 | 48,000 tokens | ~20 tokens | 2轮后 |
| 工具结果（文件读取、命令输出） | 2,000–10,000 tokens | ~50 tokens | 4轮后 |
| 工具结果（网页抓取） | 1,000–5,000 tokens | ~30 tokens | 4轮后 |
| 工具调用参数 | 200–2,000 tokens | ~20 tokens | 4轮后 |

### 不会被触碰的内容

- 最近的消息（`staleTurns` 轮以内）
- 用户文字消息（本来就很小）
- 助手文字回复（实际对话内容）
- 思考过程
- 小型工具结果（低于 `minTokensToSqueeze`）
- 工具调用结构（type、id、name 保留，确保 API 配对）

### 生产结果

首次生产部署：

```
ClawSqueezer 之前：  上下文涨到 180K → 触发压缩
ClawSqueezer 之后：  73 个块被清理，每次调用释放 ~96K tokens
                    图片: 释放 11K | 工具结果: 释放 85K
```

## 独立使用

```typescript
import { squeeze } from "@cldy-com/clawsqueezer";

const { messages: squeezed, stats } = squeeze(messages, {
  staleTurns: 4,
  imageAgeTurns: 2,
});

console.log(`释放了 ${stats.tokensFreed} tokens`);
console.log(`清理: ${stats.imagesEvicted} 张图片, ${stats.toolResultsEvicted} 个工具结果`);
```

## 为什么不直接压缩摘要？

我们先试过了。效果不错（摘要缩小 55%），但真正的浪费不在摘要 —— 而是占上下文 86% 的过期图片和工具输出。压缩摘要省 3K tokens，清理一张旧截图省 48K。

## 许可证

Apache-2.0 — 由 [CLDY](https://cldy.com) 构建
