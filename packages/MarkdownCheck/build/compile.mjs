import {execFileSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";
import {Buffer} from "node:buffer";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {runInNewContext} from "node:vm";
import {deflateSync} from "fflate";
import {minify} from "terser";

const [wasm, command, sources] = process.argv.slice(2);
const generated = execFileSync(process.execPath, [
    fileURLToPath(new URL("./node_modules/binaryen/bin/wasm2js", import.meta.url)),
    wasm, "--all-features",
], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024});

// wasm2js emits one module instance and re-exports its methods as ESM bindings.
// QuickJS loads a plain script, with a fresh checker instance per invocation.
const exports = [...generated.matchAll(/^export var (\w+) = retasmFunc\.\1;$/gm)];
const names = exports.map((match) => match[1]).sort().join(" ");
if (names !== "check memory prepare_input report_offset" || /^import\b/m.test(generated)) {
    throw new Error("Unexpected wasm2js interface");
}
const checker = generated.replace(/^export var \w+ = retasmFunc\.\w+;$/gm, "");
const run = readFileSync(join(sources, "run.js"), "utf8");
const {code} = await minify(`
    function checkMarkdown(snapshot) {
        function instantiateChecker() {
            ${checker}
            return retasmFunc;
        }
        ${run}
        return run(snapshot);
    }
`, {format: {ascii_only: true}});

const source = Buffer.from(code, "ascii");
const payload = Buffer.from(deflateSync(source, {level: 9})).toString("base64");

// Only the synchronous inflater is reachable from this wrapper. Terser
// drops the rest of fflate's browser build, including its worker helpers.
const fflate = readFileSync(new URL("./node_modules/fflate/esm/browser.js", import.meta.url), "utf8")
    .replace(/^export \{[^\n]+\};$/gm, "")
    .replace(/^export /gm, "");
const {code: packed} = await minify(`
function run(snapshot) {
    try {
        const inflate = (() => {
            ${fflate}
            return inflateSync;
        })();
        const base64 = ${JSON.stringify(payload)};
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const lookup = new Uint8Array(128);
        for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
        const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
        const compressed = new Uint8Array(base64.length / 4 * 3 - padding);
        for (let i = 0, j = 0; i < base64.length; i += 4) {
            const bits = (lookup[base64.charCodeAt(i)] << 18)
                | (lookup[base64.charCodeAt(i + 1)] << 12)
                | (lookup[base64.charCodeAt(i + 2)] << 6)
                | lookup[base64.charCodeAt(i + 3)];
            compressed[j++] = bits >> 16;
            compressed[j++] = bits >> 8;
            compressed[j++] = bits;
        }
        const inflated = inflate(compressed, new Uint8Array(${source.length}));
        if (inflated.length !== ${source.length}) throw new Error("Invalid checker payload");
        let script = "";
        for (let i = 0; i < inflated.length; i += 4096) {
            script += String.fromCharCode(...inflated.subarray(i, i + 4096));
        }
        return new Function("snapshot", script + "\\nreturn checkMarkdown(snapshot);")(snapshot);
    } catch {
        return {kind: "error", code: "unsupported-input", message: "Markdown check failed."};
    }
}
`, {format: {ascii_only: true, comments: false}});

// Exercise the packed entry before it can replace a previously built package.
const execute = runInNewContext(packed + "\nrun");
const probe = execute({text: "😀 [x]()"});
const report = probe.kind === "text" && JSON.parse(probe.text);
if (report?.schema !== 1 || report.diagnostics[0]?.rule !== "MD042"
    || report.diagnostics[0].start !== 3) {
    throw new Error("Packed checker failed the UTF-16 smoke test");
}

writeFileSync(command, packed + "\n", "ascii");
console.log(`WASM2JS ${Buffer.byteLength(generated)} bytes, minified checker ${source.length} bytes, command.js ${packed.length + 1} bytes`);
