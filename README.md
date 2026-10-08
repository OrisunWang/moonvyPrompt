# moonvyPrompt

将 Moonvy 月维设计稿转换为 AI 可用的 UI 树、实现提示词和本地 PNG 素材。基于同级 lanhu-ui-prompt 的通用转换与素材导出实现，网络协议与 Genome 适配独立维护。

## 安装与凭据

Node >=20.9，pnpm。

```bash
git clone https://github.com/OrisunWang/moonvyPrompt.git
cd moonvyPrompt
pnpm install
pnpm build
```

在本项目 `.env.local` 中保存已登录浏览器向 `https://api.moonvy.com` 请求的完整认证头：

```dotenv
MOONVY_AUTHORIZATION="Bearer your-session-token"
# 可选，仅发送到 api.moonvy.com
MOONVY_COOKIE="your-cookie-header"
```

文件与输出已忽略。不要在聊天、Git 或错误日志中分享凭据。`auth test` 只检查本地配置，不证明令牌有效；`run` 的真实请求验证访问权限。

## 命令与交付

本地使用 `node dist/cli.js`，链接安装后可使用 `moonvy-ui-prompt`：

```bash
node dist/cli.js parse "https://moonvy.com/project/<projectId>/<folderId>/<itemId>" --json
node dist/cli.js auth test --json
node dist/cli.js run "<moonvy-url>" --out output/page --json
node dist/cli.js fetch "<moonvy-url>" --out output/page --json
node dist/cli.js tree "<moonvy-url>" --out output/page --json
node dist/cli.js prompt "<moonvy-url>" --out output/page --json
node dist/cli.js tree fixtures/genome-sample.json --from-file --out output/fixture --json
node dist/cli.js prompt output/fixture/ui-tree.json --from-file --out output/fixture --json
```

`run` 写入原始节点/项目/Genome 响应、`ui-tree.json`、`prompt.md`、`manifest.json`；默认下载源数据可导出的可见切图，生成 `assets/index.json`。`--no-download-assets` 仅关闭切图，预览行为保留；本地 `--from-file` 不联网。

保持蓝湖项目的文字 intrinsic sizing、文字间距 reference-only、布局提示、token、渐变/圆角/阴影、UI 名称导出、内容复用、文件增量写入及经过验证的旧 ZIP 清理。PNG 素材按 UI 名称导出 @1x/@2x/@3x；以源切图倍率与实际像素确定逻辑尺寸，不拿图层包围盒猜测。分辨率不足不放大；无可信密度保留 original PNG。相同素材不要重复添加，目标 App 中已有的内容应复用；工具不自动写 App Assets。

## 月维适配与限制

官方前端读取 `POST /anynode/get`、`GET /project/project-info`、`files.genome.url`、`pages[0]`、`images` 和 `slices.base/max`。Genome 坐标相对最近的 isFrame 祖先，普通 group 不引入额外偏移。项目重命名映射用于素材名称。

字体命名样式转换为明确字重，行高保留 px、percent/% 和 em 单位；自动行高交由文字自身排版。首次版本对多段文字、复合 paint、复杂变换、mask、变量绑定、非线性渐变及受限导出倍率给出检查警告；完整事实保留在 raw Genome。SVG-only 切图报告缺少支持的 raster 源。结构缺失时仅在有效预览存在的情况下输出低置信度树；401/403 或无可用设计直接报错。

实际验收进度与来源依据见 [产品规格](docs/product-spec.md)，字段契约见 [UI 树格式](docs/ui-tree-schema.md)。

## 开发与技能

```bash
pnpm typecheck
pnpm test
pnpm build
bash scripts/sync-skill.sh
```

版本化技能在 `skills/moonvy-ui-prompt/`，安装到 `${CODEX_HOME:-$HOME/.codex}/skills/moonvy-ui-prompt`，可通过 `MOONVY_SKILL_DEST` 覆盖。导入 helper 默认从本项目 `.env.local` 读取凭据，构建最新源码并交付到 `output/<itemId前8位>/`：

```bash
bash skills/moonvy-ui-prompt/scripts/import_moonvy_ui.sh "<moonvy-url>"
```

从仓库内调用 helper 时自动定位当前项目；安装后的技能可以通过 `MOONVY_UI_PROMPT_DIR` 指向你的克隆目录。可用环境覆盖 `MOONVY_UI_PROMPT_DIR`、`MOONVY_ENV_FILE`、`MOONVY_OUTPUT_ROOT`；保留原项目和已安装蓝湖技能。
