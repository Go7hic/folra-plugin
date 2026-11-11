# Folra Markdown checker

Folra 官方 Markdown Check 插件。宿主传入文档原文，插件通过签名沙盒工作进程运行 Rust 检查器，返回只读诊断报告。

## 规则与位置

首版只支持以下四条规则，没有修复接口。

| 规则 | 报告条件 |
| --- | --- |
| MD042 | Markdown 链接的解析目标为空，包括目标为空的已定义引用链接。图片目标不属于此规则 |
| MD045 | Markdown 图片没有非空白的替代文字。按图片内部事件判断，格式化文字、行内代码、数学内容和嵌套图片文字都计入 |
| MD052 | 显式完整引用或 collapsed 引用未定义，含引用图片。普通 `[文本]` shortcut 和未定义脚注不报告 |
| MD001 | 当前标题比前一个标题上升超过一级，包含 Setext、引用和列表内的标题。首个 H3 不构成跳级 |

诊断使用源码位置，不是渲染后的文本位置。`start` 和 `end` 是从零开始的 UTF-16 code unit 偏移，区间半开。
`line`、`column` 从一开始，列也按 UTF-16 code unit 计数，tab 算一个单位。CRLF 算一个换行，CR 和 LF 单独出现也算换行。
emoji 的 surrogate pair 算两个单位，combining mark 单独计数，不按字形簇计数。

链接和图片使用 parser 给出的原始范围。pulldown-cmark 0.13.6 对 `[label][]` 的范围只包含 `[label]`，不包含末尾 `[]`。
标题范围包含标题标记和内容，去掉行末 CR、LF。

成功时 `run(snapshot)` 返回 `{kind: "text", text: report}`。其中 `report` 是 schema 1 的 ASCII JSON 字符串。

```json
{"schema":1,"diagnostics":[{"rule":"MD042","start":0,"end":5,"line":1,"column":1}],"truncated":false}
```

示例输入是 `[x]()`。诊断按 `start`、`rule`、`end` 排序，以这三项去重。
只保留源码最靠前的 200 条，发现第 201 条独立诊断时设置 `truncated=true`。未截断时为 `false`。
原始输入最多 1 MiB，输出最多 256 KiB。错误不返回部分诊断。

## Parser 边界

使用 pulldown-cmark events、offset iterator 和 broken-link callback，不用正则或另一套 Markdown 语法分析器。
callback 只为未定义的完整引用和 collapsed 引用提供临时空目标，规则只在 parser 实际生成对应事件后报告。

启用 math、Wiki links、tables、tasks、strikethrough、footnotes、YAML 和 `+++` 前置元数据选项。
代码块、行内代码、HTML 原始事件、元数据、math 和 Wiki 内部不检查链接或标题。
未闭合的代码围栏是合法输入，其后内容保留为代码。HTML 按 CommonMark 的 block 和 inline HTML 事件边界处理。
行内标签之间若 parser 仍识别 Markdown，Markdown 内容仍可报告。

Folra 的 `\boxed{…}` 作为 math 内容跳过，`<!--folra:highlight=blue-->` 作为 HTML 注释跳过。
高亮内部的可见 Markdown 仍接受检查。此包不是 Folra 编辑引擎所有自定义语法的完整替代解析器。
保留上游 parser 的引用展开预算，极多次引用长目标时，parser 可能将预算耗尽后的引用作为普通文本，导致漏报。
本包没有绕过这个资源保护，也不承诺与 rumdl 或 markdownlint 的全规则语义一致。

不检查锚点或文件是否存在，不要求 80 列或 H1，不增加表格规则，不提供 auto-fix。

## 构建与验证

从仓库根目录运行。需要 Rust 1.97.1、对应的 `wasm32-unknown-unknown` 目标和 `rust-docs` 组件，以及 Node.js 18+、npm 和 Python 3.10+。构建从 `rust-docs` 读取标准库许可证。通过 `RUSTUP_TOOLCHAIN` 可指定工具链。

复刻 Folra 宿主已批准的 1.0.0 包时，使用 macOS x86_64 版 Rust 1.97.1（Apple 芯片可通过 Rosetta 运行）。Rust 编译器的宿主架构会影响生成的字节。用下方的 `plugin validate` 核对发行包摘要，1.0.0 的批准摘要为 `59e36aa71c09648a710162d438a5bbc935d013123ef6927b70ab693e85cb9052`。

```sh
cargo test --manifest-path packages/MarkdownCheck/Cargo.toml --locked --lib --target-dir .build/official-plugin-build/rust-tests
python3 scripts/build-markdown-check-plugin.py --output-dir dist/plugins
folra_app="/Applications/Folra.app"
"$folra_app/Contents/MacOS/Folra" plugin validate dist/plugins/MarkdownCheck.folraplug --json
python3 scripts/test-markdown-check.py "$folra_app" dist/plugins/MarkdownCheck.folraplug
```

默认输出到 `.build/official-plugin-build`，其中 `MarkdownCheck.folraplug` 是可安装目录，`MarkdownCheck-1.0.0.zip` 解压后得到同一目录。许可证原文随两种产物分发。插件版本和 API 由 [manifest.json](build/manifest.json) 定义。

Cargo 按 `Cargo.lock` 编译 WASM。Binaryen 123.0.0 将它转换成普通 JavaScript，Terser 5.44.0 压缩源码，fflate 0.8.2 压缩载荷并提供运行时解压。构建拒绝超过 256 KiB 的 `command.js`。npm 构建依赖及校验值锁定在 [npm-shrinkwrap.json](build/npm-shrinkwrap.json)。

Markdown 检查 1.1.0 可在支持 WASM 的 Folra 测试版安装。构建和验收命令如下。

```sh
python3 scripts/build-markdown-check-plugin.py --wasm --output-dir dist/plugins
python3 scripts/test-markdown-check.py "$folra_app" dist/plugins/MarkdownCheck-1.1.0.folraplug
```

使用 macOS x86_64 Rust 1.97.1 复刻批准包。清单声明 `runtime: "wasm"`，ZIP 携带原始 `command.wasm` 和许可证。批准摘要为 `25c60502b67eda8719a006c164b634348f36b8012e02ae58eb0f4d565ca7aeb2`。签名沙盒 XPC 直接加载这个模块。

每次调用用独立线性内存。JavaScript 将输入编码为 UTF-8，Rust 持有输入和输出缓冲区。宿主的 QuickJS 工作进程负责取消、超时和内存限制。插件返回的错误使用 API 2 的 `unsupported-input` 错误码和固定短消息。

Rust 测试覆盖四条规则、UTF-16 位置、CRLF、Folra 扩展、截断及 UTF-8 输入边界。构建先执行压缩后的 `command.js`，检查含 emoji 的输入是否返回正确的 UTF-16 偏移。签名宿主的 `plugin test` 再通过 QuickJS 工作进程运行八个用例，其中包括长文档和空文档。依赖来源见 [UPSTREAM.md](UPSTREAM.md)。
