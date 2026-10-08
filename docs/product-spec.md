# 月维 UI Prompt 产品与实施规格

## 产品目标与范围
基于 lanhu-ui-prompt 当前代码创建独立 TypeScript CLI，将一个 Moonvy 月维设计稿转换为 raw/、ui-tree.json、prompt.md、manifest.json 和 assets/index.json。保持 parse/fetch/tree/prompt/run/auth test 命令与 JSON 错误封装，默认下载可导出的可见素材，保留 UI 命名、多倍率 PNG、内容去重、增量写入及验证后的旧 ZIP 清理。

## 用户流程与模块
用户复制 https://moonvy.com/project/<projectId>/<folderId>/<itemId>，将 MOONVY_AUTHORIZATION（完整 Bearer 值）写入 gitignored .env.local，执行 run --out。URL 解析模块提取 projectId/folderId/itemId；客户端通过官方 API 查询节点及项目磁盘信息；Genome 适配器转换设计层；通用标准化、token、prompt 和 PNG 导出模块生成交付物。离线 tree --from-file 接受 Genome JSON 或既有通用 fixture。

## 数据模型与来源事实
2026-10-08 查阅月维官方前端 2.0.248（build 1418）：默认 API 为 https://api.moonvy.com，POST /anynode/get 参数 projectId/id/lv=full；GET /project/project-info 参数 projectId。节点 files.genome.url 指向 JSON；Genome pages[0] 为当前稿件根层，rect 使用 x/y/w/h，图像表 images[id].url 在 Genome >=1.4 时优先，否则使用 https://file-cn.moonvy.com/p/<disk>/c/md5/<imageId>。具体字段转换以官方前端和授权实稿为准，不凭空推断接口。

## 业务规则
保留层级、绝对与相对坐标、颜色、渐变、圆角、字体、阴影、布局建议及精确邻居间距。文字尺寸仅作参考，目标界面使用 intrinsic sizing、动态换行；涉及文字的间距标为 reference-only。仅下载源数据提供的素材，不将普通预览当作所有图层切图；相同内容复用素材，冲突 UI 名称添加数字后缀。不修改目标 App 或签名配置。

## 状态与异常
缺失 URL 标识退出 2；缺失登录态退出 3；401/403、业务拒绝、节点不存在及网络/响应错误退出 4，不能成功输出空稿件。Genome 不可用但有效预览存在时输出低置信度截图树，缺少两者报错。单张素材失败降级警告，不阻止已有结构交付。原始数据留本地；凭据不进入日志与产物，API 凭据只发送至确切官方 API origin，禁止重定向携带凭据。

## 技术约束
Node >=20.9、pnpm、TypeScript、sharp、fflate；不自动化登录、不用 OCR 猜测样式、不生成框架代码。API 是私有接口，记录当前依据与实际验证范围，变化需要更新 adapter 和 fixtures。

## 验收标准
URL 解析及拒绝非法主机/路径；Genome 层级/几何/文字/样式/素材转换；默认与禁用下载；源密度不足不放大；名称安全、去重、ZIP 校验和重跑一致性；凭据隔离与访问错误；CLI 离线生成；技能 helper 参数转发、构建失败中断；typecheck/test/build 全通过；版本化技能与安装副本匹配；用户链接授权实稿验证并检查警告。

## 实稿验收结果
2026-10-08 使用用户保存的本地登录态完成 授权测试稿件 全流程导入，真实 API 返回直接节点对象，成功读取 Genome 与预览。画布 375×812，48 个可见节点，其中 13 个文字节点；18 项切图引用按内容复用为 13 套素材，生成 39 个 @1x/@2x/@3x PNG。节点类型只依据实际文字值或显式类型，忽略空的可选文字字段。文字命名字重转换为明确数值，行高支持 px、percent/% 和 em；自动行高保留 intrinsic sizing。

实稿输出在 output/<itemId-prefix>，包含 raw 数据、ui-tree.json、prompt.md、manifest.json 和 assets/index.json。当前置信度 medium：源画布的多重 paint 与 clipping 需要对照预览复核，完整源事实留在 raw Genome。源文件网络连接曾重置，现已恢复并完成下载；将来不可用时仍按既定降级或错误规则处理。

## 测试与安装结果
pnpm install --offline --frozen-lockfile、pnpm build、pnpm test（7 文件 / 56 测试）及官方 quick_validate.py 技能验证通过。技能已同步到 ~/.codex/skills/moonvy-ui-prompt，两份维护文件 cmp 完全一致。output/fixture 为离线示例，output/<itemId-prefix> 为用户授权实稿。凭据和全部实稿输出均被 Git 忽略，原 lanhu-ui-prompt 仓库保持干净。

## 仓库发布
源码仓库为 https://github.com/OrisunWang/moonvyPrompt，CLI 名称保留 moonvy-ui-prompt。安装需 pnpm install 与 pnpm build。仓库内技能 helper 自动定位克隆目录，安装副本支持 MOONVY_UI_PROMPT_DIR 或约定的 GitHub 目录。公开测试使用合成标识，登录态、原始实稿和生成物不提交。
