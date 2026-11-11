use crate::{check_bytes, MAX_INPUT_BYTES};
use std::cell::RefCell;

struct Buffers {
    input: Vec<u8>,
    report: Vec<u8>,
}

thread_local! {
    static BUFFERS: RefCell<Buffers> = const {
        RefCell::new(Buffers { input: Vec::new(), report: Vec::new() })
    };
}

// JS writes exactly length bytes at this offset in its own WASM instance.
// Rust retains ownership and never reconstructs a slice from a JS pointer.
#[unsafe(no_mangle)]
extern "C" fn prepare_input(length: usize) -> *mut u8 {
    BUFFERS.with_borrow_mut(|buffers| {
        buffers.report.clear();
        buffers.input.clear();
        if length > MAX_INPUT_BYTES {
            return std::ptr::null_mut();
        }
        buffers.input.resize(length, 0);
        buffers.input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
extern "C" fn check() -> i32 {
    BUFFERS.with_borrow_mut(|buffers| {
        buffers.report.clear();
        match check_bytes(&buffers.input) {
            Ok(report) => {
                buffers.report = report;
                buffers.report.len() as i32
            }
            Err(status) => status as i32,
        }
    })
}

#[unsafe(no_mangle)]
extern "C" fn report_offset() -> *const u8 {
    BUFFERS.with_borrow(|buffers| buffers.report.as_ptr())
}
