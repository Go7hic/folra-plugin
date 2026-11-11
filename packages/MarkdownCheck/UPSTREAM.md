# 依赖来源与许可证

本包使用 crates.io 发布包，精确解析版本和校验值记录在 `Cargo.lock`。本包规则实现为新代码，没有拷贝 rumdl 源码。
rumdl 即使关闭默认 features 仍带入 clap、oxc、toml 等非可选依赖，首版采用独立的小规则集。

`pulldown-cmark` 精确锁定 `=0.13.6`，`default-features=false`，不启用默认 getopts、HTML 输出器或 serde。
0.13.6 的发布 manifest 没有 `std` feature，最初要求的 `features=["std"]` 会被 Cargo 拒绝。
其 parser 本身使用 std，因此实际配置为关闭 default features，不传不存在的 feature。
已读取下载包的 `Cargo.toml`、`src/lib.rs` 和 `src/parse.rs` 确认这些 API 和范围行为。

`serde_json` 直接依赖解析为 1.0.154，使用默认 std，不直接依赖 serde，也不启用 derive。
正常构建共使用 8 个上游 crate。下表的许可证表达式来自各发布包的 Cargo metadata。

| crate | 锁定版本 | SPDX 许可证 | 上游 |
| --- | --- | --- | --- |
| pulldown-cmark | 0.13.6 | MIT | https://github.com/raphlinus/pulldown-cmark |
| bitflags | 2.13.2 | MIT OR Apache-2.0 | https://github.com/bitflags/bitflags |
| memchr | 2.8.3 | Unlicense OR MIT | https://github.com/BurntSushi/memchr |
| unicase | 2.10.0 | MIT OR Apache-2.0 | https://github.com/seanmonstar/unicase |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| itoa | 1.0.19 | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| zmij | 1.0.23 | MIT | https://github.com/dtolnay/zmij |

Cargo.lock 另外保留以下 6 个目标条件或可选依赖。当前 normal、build 树不编译它们，不要把 lockfile 中出现 derive 误报成启用了 derive。
其中 serde_core 发布 manifest 有 `target.'cfg(any())'.dependencies.serde_derive`。

| crate | 锁定版本 | SPDX 许可证 | 上游 |
| --- | --- | --- | --- |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | https://github.com/dtolnay/proc-macro2 |
| quote | 1.0.47 | MIT OR Apache-2.0 | https://github.com/dtolnay/quote |
| syn | 3.0.10 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | https://github.com/dtolnay/unicode-ident |

重新核对时运行：

```sh
cargo tree --manifest-path packages/MarkdownCheck/Cargo.toml --locked --offline --target wasm32-unknown-unknown --edges normal,build --format '{p} | {l}'
cargo metadata --manifest-path packages/MarkdownCheck/Cargo.toml --locked --offline --filter-platform wasm32-unknown-unknown --format-version 1
```

上游发布包内的 LICENSE 文件和版权声明是分发依据；此清单不能代替许可证原文。
插件构建脚本按 WASM 目标的正常依赖树汇总各 crate 的 MIT 原文，并从固定版本的 Rust 工具链读取标准库版权声明及 MIT、Apache-2.0 原文。

[构建锁文件](build/npm-shrinkwrap.json) 固定 Binaryen 123.0.0、Terser 5.44.0 和 fflate 0.8.2。发布包附带 Binaryen 的 Apache-2.0 和 fflate 的 MIT 原文，因为 `command.js` 包含 wasm2js 生成的运行时代码及 fflate 解压代码。Terser 只用于构建。
