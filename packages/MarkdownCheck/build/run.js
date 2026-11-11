function run(snapshot) {
    const failed = {kind: "error", code: "unsupported-input", message: "Markdown check failed."};
    if (typeof snapshot?.text !== "string") return failed;

    const text = snapshot.text;
    let length = 0;
    for (const character of text) {
        const point = character.codePointAt(0);
        if (point >= 0xd800 && point <= 0xdfff) {
            return {kind: "error", code: "unsupported-input", message: "Markdown input is not valid Unicode."};
        }
        length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (length > 1024 * 1024) {
            return {kind: "error", code: "unsupported-input", message: "Markdown input exceeds 1 MiB."};
        }
    }

    const {memory, prepare_input, check, report_offset} = instantiateChecker();
    const offset = prepare_input(length);
    if (offset === 0) return failed;
    const input = new Uint8Array(memory.buffer, offset, length);
    let i = 0;
    for (const character of text) {
        const point = character.codePointAt(0);
        if (point < 0x80) {
            input[i++] = point;
        } else {
            if (point < 0x800) {
                input[i++] = 0xc0 | (point >> 6);
            } else {
                if (point < 0x10000) {
                    input[i++] = 0xe0 | (point >> 12);
                } else {
                    input[i++] = 0xf0 | (point >> 18);
                    input[i++] = 0x80 | ((point >> 12) & 63);
                }
                input[i++] = 0x80 | ((point >> 6) & 63);
            }
            input[i++] = 0x80 | (point & 63);
        }
    }

    const size = check();
    if (size <= 0 || size > 256 * 1024) return failed;

    // The checker can grow memory, so acquire a fresh view after it returns.
    const output = new Uint8Array(memory.buffer, report_offset(), size);
    let report = "";
    for (let i = 0; i < output.length; i += 4096) {
        report += String.fromCharCode(...output.subarray(i, i + 4096));
    }
    return {kind: "text", text: report};
}
