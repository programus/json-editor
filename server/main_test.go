package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// newTestServer builds a server over an in-memory tree mirroring a real build.
func newTestServer() *server {
	return &server{
		root: fstest.MapFS{
			"index.html":            {Data: []byte("<!doctype html>app")},
			"assets/app-abc123.js":  {Data: []byte("console.log(1)")},
			"assets/app-abc123.js.gz": {Data: []byte("gzipped-js")},
			"assets/app-abc123.js.br": {Data: []byte("brotli-js")},
			"assets/style-def.css":  {Data: []byte("body{}")},
			"favicon.svg":           {Data: []byte("<svg/>")},
		},
		index: "index.html",
	}
}

func get(t *testing.T, s *server, target string, headers map[string]string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec.Result()
}

func body(t *testing.T, res *http.Response) string {
	t.Helper()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	return string(data)
}

func TestServesIndexAtRoot(t *testing.T) {
	res := get(t, newTestServer(), "/", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got := body(t, res); got != "<!doctype html>app" {
		t.Errorf("body = %q", got)
	}
}

func TestServesAsset(t *testing.T) {
	res := get(t, newTestServer(), "/assets/app-abc123.js", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got := body(t, res); got != "console.log(1)" {
		t.Errorf("body = %q", got)
	}
}

func TestUnknownRouteFallsBackToIndex(t *testing.T) {
	res := get(t, newTestServer(), "/some/deep/route", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if got := body(t, res); got != "<!doctype html>app" {
		t.Errorf("body = %q, want the SPA index", got)
	}
}

func TestMissingAssetIs404(t *testing.T) {
	// A missing file *with an extension* must not be masked by the SPA fallback,
	// or a broken deployment would look like a working one.
	res := get(t, newTestServer(), "/assets/gone-999.js", nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.StatusCode)
	}
}

func TestCacheHeaders(t *testing.T) {
	tests := []struct {
		target string
		want   string
	}{
		{"/assets/app-abc123.js", immutableCache},
		{"/assets/style-def.css", immutableCache},
		{"/", revalidateCache},
		{"/index.html", revalidateCache},
		{"/favicon.svg", revalidateCache},
		{"/unknown/route", revalidateCache},
	}
	for _, test := range tests {
		res := get(t, newTestServer(), test.target, nil)
		if got := res.Header.Get("Cache-Control"); got != test.want {
			t.Errorf("%s: Cache-Control = %q, want %q", test.target, got, test.want)
		}
	}
}

func TestPrefersBrotli(t *testing.T) {
	res := get(t, newTestServer(), "/assets/app-abc123.js",
		map[string]string{"Accept-Encoding": "gzip, deflate, br"})

	if got := res.Header.Get("Content-Encoding"); got != "br" {
		t.Fatalf("Content-Encoding = %q, want br", got)
	}
	if got := body(t, res); got != "brotli-js" {
		t.Errorf("body = %q, want the .br variant", got)
	}
	// The type must describe the decoded payload, not the ".br" wrapper.
	if got := res.Header.Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Errorf("Content-Type = %q, want a JavaScript type", got)
	}
}

func TestEncodedResponseDeclaresItsLength(t *testing.T) {
	// Without an explicit length Go falls back to chunked encoding and clients
	// cannot show download progress.
	res := get(t, newTestServer(), "/assets/app-abc123.js",
		map[string]string{"Accept-Encoding": "br"})

	if got := res.Header.Get("Content-Length"); got != "9" { // len("brotli-js")
		t.Errorf("Content-Length = %q, want 9 (the compressed size)", got)
	}
	if got := res.Header.Get("Accept-Ranges"); got != "none" {
		t.Errorf("Accept-Ranges = %q, want none", got)
	}
	if got := res.Header.Get("Last-Modified"); got == "" {
		t.Error("Last-Modified is missing")
	}
}

func TestEncodedHeadHasNoBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodHead, "/assets/app-abc123.js", nil)
	req.Header.Set("Accept-Encoding", "br")
	rec := httptest.NewRecorder()
	newTestServer().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body = %q, want empty", rec.Body.String())
	}
	if got := rec.Header().Get("Content-Length"); got != "9" {
		t.Errorf("Content-Length = %q, want 9", got)
	}
}

func TestFallsBackToGzip(t *testing.T) {
	res := get(t, newTestServer(), "/assets/app-abc123.js",
		map[string]string{"Accept-Encoding": "gzip"})

	if got := res.Header.Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := body(t, res); got != "gzipped-js" {
		t.Errorf("body = %q, want the .gz variant", got)
	}
}

func TestServesIdentityWhenNothingAccepted(t *testing.T) {
	res := get(t, newTestServer(), "/assets/app-abc123.js", nil)
	if got := res.Header.Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want none", got)
	}
	if got := body(t, res); got != "console.log(1)" {
		t.Errorf("body = %q, want the raw file", got)
	}
}

func TestServesIdentityWhenNoVariantExists(t *testing.T) {
	// The CSS in the fixture has no pre-compressed sibling.
	res := get(t, newTestServer(), "/assets/style-def.css",
		map[string]string{"Accept-Encoding": "br, gzip"})

	if got := res.Header.Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want none", got)
	}
	if got := body(t, res); got != "body{}" {
		t.Errorf("body = %q", got)
	}
}

func TestAlwaysVariesOnAcceptEncoding(t *testing.T) {
	// Required even for identity responses, or a shared cache could hand a
	// compressed body to a client that cannot decode it.
	for _, header := range []map[string]string{nil, {"Accept-Encoding": "br"}} {
		res := get(t, newTestServer(), "/assets/app-abc123.js", header)
		if got := res.Header.Get("Vary"); got != "Accept-Encoding" {
			t.Errorf("Vary = %q, want Accept-Encoding", got)
		}
	}
}

func TestRejectsNonReadMethods(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	newTestServer().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Errorf("Allow = %q", got)
	}
}

func TestHeadHasNoBody(t *testing.T) {
	req := httptest.NewRequest(http.MethodHead, "/assets/app-abc123.js", nil)
	rec := httptest.NewRecorder()
	newTestServer().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body = %q, want empty", rec.Body.String())
	}
}

func TestPathTraversalIsRefused(t *testing.T) {
	// path.Clean collapses these before they reach the filesystem, so they
	// resolve inside the root instead of escaping it.
	for _, target := range []string{
		"/../etc/passwd",
		"/assets/../../etc/passwd",
		"/./../../etc/shadow",
	} {
		res := get(t, newTestServer(), target, nil)
		if res.StatusCode == http.StatusOK && body(t, res) == "<!doctype html>app" {
			continue // collapsed to a path inside the root, then fell back
		}
		if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 404, 400 or the SPA fallback", target, res.StatusCode)
		}
	}
}

func TestHealthz(t *testing.T) {
	rec := httptest.NewRecorder()
	handleHealth(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "ok\n" {
		t.Errorf("body = %q", rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func TestNegotiate(t *testing.T) {
	tests := []struct {
		header string
		want   string
	}{
		{"", ""},
		{"gzip", "gzip"},
		{"br", "br"},
		{"gzip, br", "br"},          // brotli preferred when both are offered
		{"br;q=1.0, gzip;q=0.8", "br"},
		{"gzip, br;q=0", "gzip"},    // explicit rejection of brotli
		{"br;q=0, gzip;q=0", ""},    // both rejected
		{"deflate", ""},             // nothing we have a variant for
		{"GZIP", "gzip"},            // tokens are case-insensitive
		{"  gzip  ", "gzip"},
	}
	for _, test := range tests {
		if got, _ := negotiate(test.header); got != test.want {
			t.Errorf("negotiate(%q) = %q, want %q", test.header, got, test.want)
		}
	}
}

func TestResolve(t *testing.T) {
	tests := []struct {
		path string
		want string
		ok   bool
	}{
		{"/", "index.html", true},
		{"/index.html", "index.html", true},
		{"/assets/app.js", "assets/app.js", true},
		{"/deep/route", "deep/route", true},
		{"//double//slash", "double/slash", true},
		{"/../escape", "escape", true}, // cleaned, not escaped
	}
	for _, test := range tests {
		got, ok := resolve(test.path)
		if ok != test.ok || got != test.want {
			t.Errorf("resolve(%q) = (%q, %v), want (%q, %v)", test.path, got, ok, test.want, test.ok)
		}
	}
}
