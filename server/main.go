// A minimal static file server for the built JSON editor.
//
// The app is a pure client-side bundle with no backend, so this only needs to
// serve files, negotiate pre-compressed variants, set sane cache headers and
// fall back to index.html for client-side routes. Keeping it to the standard
// library means the image has zero third-party dependencies and can run on
// `scratch` as an unprivileged static binary.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	// Hashed asset filenames change whenever their content does, so they can be
	// cached indefinitely.
	immutableCache = "public, max-age=31536000, immutable"
	// The entry point must be revalidated, or clients would never see a new
	// deployment. "no-cache" still allows a 304, it just forbids blind reuse.
	revalidateCache = "no-cache"
)

// encoding describes a pre-compressed variant produced at build time.
type encoding struct {
	// token as it appears in Accept-Encoding.
	token string
	// suffix of the pre-compressed file on disk.
	suffix string
}

// Ordered by preference: brotli compresses better, so offer it first.
var encodings = []encoding{
	{token: "br", suffix: ".br"},
	{token: "gzip", suffix: ".gz"},
}

type server struct {
	root fs.FS
	// index is the SPA fallback document, served for unknown paths.
	index string
}

func main() {
	// The image has no shell or curl, so the binary doubles as its own probe.
	probe := flag.Bool("healthcheck", false, "probe a running server, then exit")
	flag.Parse()

	addr := envOr("LISTEN_ADDR", ":8080")
	dir := envOr("STATIC_ROOT", "/srv/http")

	if *probe {
		if err := runProbe(addr); err != nil {
			log.Printf("healthcheck failed: %v", err)
			os.Exit(1)
		}
		return
	}

	srv := &server{root: os.DirFS(dir), index: "index.html"}

	// Fail fast on a broken image rather than serving 404s forever.
	if _, err := fs.Stat(srv.root, srv.index); err != nil {
		log.Fatalf("static root %q does not contain %s: %v", dir, srv.index, err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealth)
	mux.Handle("/", srv)

	httpServer := &http.Server{
		Addr:    addr,
		Handler: mux,
		// Bound how long a slow or idle client can tie up a connection.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("serving %s on %s", dir, addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// runProbe requests /healthz over loopback and reports whether it answered.
func runProbe(addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("parsing %q: %w", addr, err)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	url := "http://127.0.0.1:" + port + "/healthz"

	res, err := client.Get(url)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	// Drain so the connection can be reused rather than reset.
	_, _ = io.Copy(io.Discard, res.Body)

	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return nil
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Never cache health probes.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write([]byte("ok\n"))
	}
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name, ok := resolve(r.URL.Path)
	if !ok {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	// Unknown paths fall back to the SPA entry point, but a missing asset must
	// stay a 404: silently returning HTML for a missing .js hides real errors.
	if !isFile(s.root, name) {
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		name = s.index
	}

	s.serveFile(w, r, name)
}

// resolve converts a request path into a slash-separated fs.FS name.
//
// fs.FS names are always relative and never contain ".." segments, and
// fs.ValidPath rejects anything that does, so path traversal cannot escape the
// root. path.Clean also collapses any "../" before that check.
func resolve(urlPath string) (string, bool) {
	cleaned := path.Clean("/" + urlPath)
	name := strings.TrimPrefix(cleaned, "/")
	if name == "" {
		return "index.html", true
	}
	if !fs.ValidPath(name) {
		return "", false
	}
	return name, true
}

func isFile(root fs.FS, name string) bool {
	info, err := fs.Stat(root, name)
	return err == nil && info.Mode().IsRegular()
}

func (s *server) serveFile(w http.ResponseWriter, r *http.Request, name string) {
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", immutableCache)
	} else {
		w.Header().Set("Cache-Control", revalidateCache)
	}

	// Content-Type must come from the real name: a ".js.br" variant is still
	// JavaScript, and Go would otherwise guess from the ".br" extension.
	if contentType := mime.TypeByExtension(path.Ext(name)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}

	// Any response here varies by Accept-Encoding, including the identity case,
	// or a shared cache could serve a compressed body to a client that cannot
	// decode it.
	w.Header().Add("Vary", "Accept-Encoding")

	served := name
	encoded := false
	if enc, suffix := negotiate(r.Header.Get("Accept-Encoding")); enc != "" {
		if variant := name + suffix; isFile(s.root, variant) {
			w.Header().Set("Content-Encoding", enc)
			served = variant
			encoded = true
		}
	}

	file, err := s.root.Open(served)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = file.Close() }()

	readSeeker, ok := file.(interface {
		Read([]byte) (int, error)
		Seek(int64, int) (int64, error)
	})
	if !ok {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	info, err := file.Stat()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if encoded {
		// ServeContent omits Content-Length once Content-Encoding is set, falling
		// back to chunked transfer. The body is a whole pre-compressed file of
		// known size, so declaring the length lets clients show real progress.
		// Range requests are declined for the same reason: offsets would refer to
		// the compressed bytes, which is not what a client asking for a range of
		// this resource means.
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
		w.Header().Set("Accept-Ranges", "none")
		w.Header().Set("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodHead {
			return
		}
		_, _ = io.Copy(w, readSeeker)
		return
	}

	// ServeContent handles Range, If-Modified-Since and ETag negotiation. The
	// name is passed empty so it keeps the Content-Type set above.
	http.ServeContent(w, r, "", info.ModTime(), readSeeker)
}

// negotiate picks the best pre-compressed encoding the client accepts.
//
// This is a deliberate simplification of RFC 9110 quality values: it only
// checks for the token's presence and honours an explicit "q=0" rejection,
// which covers every real browser.
func negotiate(header string) (token, suffix string) {
	if header == "" {
		return "", ""
	}
	accepted := map[string]bool{}
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		name := strings.ToLower(strings.TrimSpace(fields[0]))
		if name == "" {
			continue
		}
		rejected := false
		for _, param := range fields[1:] {
			param = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(param), " ", ""))
			if param == "q=0" || strings.HasPrefix(param, "q=0.0") {
				rejected = true
			}
		}
		if !rejected {
			accepted[name] = true
		}
	}
	for _, enc := range encodings {
		if accepted[enc.token] {
			return enc.token, enc.suffix
		}
	}
	return "", ""
}
