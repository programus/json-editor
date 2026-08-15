module github.com/programus/json-editor/server

// A floor, not a pin: newer toolchains build this module fine. Paired with
// GOTOOLCHAIN=local in the Dockerfile, it rejects any toolchain old enough to
// have left Go's support window.
go 1.26
