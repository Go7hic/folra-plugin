# Folra 官方插件

这里维护 [Folra](https://folra.app) 官方插件的源码、用例和打包脚本。

| 插件 | 源码 | 功能 |
| --- | --- | --- |
| Markdown 检查 | [Rust 核心和构建说明](packages/MarkdownCheck/) | 检查标题跳级、空链接、缺少替代文字的图片和未定义引用 |
| 模板速记 | [模板与用例](plugins/official/quick-templates/) | 生成中英日会议纪要、读书笔记和日记 |
| 中文排版 | [排版规则与用例](plugins/official/chinese-typography/) | 调整汉字与拉丁字母或数字之间的空格，可选转换中文语境的标点 |

## 构建与验证

用支持官方插件和插件 CLI 的签名 Folra App 验证。将下方路径替换为本机的测试版 App 路径。所有命令均在本仓库根目录执行。

```sh
folra_app="/Applications/Folra.app"

# 运行模板速记和中文排版的用例，再打包。
python3 scripts/package-official-plugins.py "$folra_app"

# 构建 Markdown 检查，运行其签名宿主用例。
python3 scripts/build-markdown-check-plugin.py --output-dir dist/plugins
python3 scripts/test-markdown-check.py "$folra_app" dist/plugins/MarkdownCheck.folraplug
```

Markdown 检查需要 Rust 1.97.1、`wasm32-unknown-unknown`、`rust-docs`、Node.js 18+、npm 和 Python 3.10+。详见[构建说明](packages/MarkdownCheck/README.md)。

## 发行与安装

构建产物写到 `dist/plugins/`。确认版本和签名宿主测试结果后，把 ZIP 以原文件名上传到 [GitHub Releases](https://github.com/Go7hic/folra-plugin/releases)。新版插件的内容摘要需要加入 Folra 宿主的批准列表，官网目录也需要登记实际的 Release 标签。宿主版本和下载页应与插件包一起核对。

下载并解压 ZIP 后，在 Folra 中选择「插件 → 管理插件… → 安装官方插件…」，选取解压后的 `.folraplug`。插件命令随后会出现在「插件」菜单。
