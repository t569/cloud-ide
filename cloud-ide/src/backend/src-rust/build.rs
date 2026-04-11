// backend/src-rust/build.rs

/*
* This file runs before our main code compiles, it's used for napi builds and stuff
*/

extern crate napi_build;
fn main() {
    napi_build::setup();
}