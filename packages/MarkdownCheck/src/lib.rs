//! Read-only Markdown diagnostics for the official Folra plugin.

mod checker;
#[cfg(test)]
mod tests;
#[cfg(target_arch = "wasm32")]
mod wasm;

const MAX_INPUT_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_DIAGNOSTICS: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
enum Status {
    InputLimit = -1,
    InvalidInput = -2,
    InternalError = -3,
    OutputLimit = -4,
}

fn check_bytes(input: &[u8]) -> Result<Vec<u8>, Status> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(Status::InputLimit);
    }
    let text = std::str::from_utf8(input).map_err(|_| Status::InvalidInput)?;
    checker::check(text)
}
