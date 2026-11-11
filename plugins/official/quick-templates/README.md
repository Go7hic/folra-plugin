# Quick Templates

在 Folra 的原生插件表单里选择会议纪要、读书笔记或日记，再选择英文、简体中文或日文。默认模板是会议纪要，Folra 按界面语言预选模板语言。语言选项控制模板正文和标题错误提示。

标题可留空，留空时使用所选语言的模板名。自定义标题最多 120 个 UTF-16 码元，去掉首尾空白后作为一级标题。插件拒绝换行和控制字符，并转义标题里的 Markdown 标记。日期由用户填写。

提交表单后可以复制生成的 Markdown 文本。选择插入时，插入点是原光标或原选区末端。选择替换时，范围是整篇文稿。两种操作都先预览差异，确认应用后才会修改文稿。

输出采用文稿中第一次出现的 CRLF 或 LF，无换行时使用 LF。

## 验证

在仓库根目录使用已有的签名 Folra App 运行：

```sh
folra="/Applications/Folra.app/Contents/MacOS/Folra"
plugin_dir=plugins/official/quick-templates
"$folra" plugin validate "$plugin_dir" --json
"$folra" plugin test "$plugin_dir" --cases "$plugin_dir/tests/cases.json" --json
```
