// Command scb serves the game client and a small save-game API.
//
// Static files are embedded into the binary and pre-compressed at startup.
// Saves are stored as one JSON file per save code in the data directory.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
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
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

const (
	maxSaveBytes = 64 << 10
	// Save codes use an alphabet without look-alike characters (no 0/O, 1/I/L).
	codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	codeLen      = 8
)

func main() {
	addr := flag.String("addr", envOr("SCB_ADDR", ":8080"), "listen address")
	dataDir := flag.String("data", envOr("SCB_DATA", "./data"), "directory for save files")
	healthcheck := flag.Bool("healthcheck", false, "probe the local server and exit (for Docker HEALTHCHECK)")
	flag.Parse()

	if *healthcheck {
		os.Exit(probe(*addr))
	}

	store, err := newSaveStore(filepath.Join(*dataDir, "saves"))
	if err != nil {
		log.Fatalf("save store: %v", err)
	}
	static, err := newStaticHandler()
	if err != nil {
		log.Fatalf("static files: %v", err)
	}

	limiter := newRateLimiter(30, time.Minute)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("POST /api/saves", limiter.wrap(store.create))
	mux.HandleFunc("PUT /api/saves/{code}", limiter.wrap(store.update))
	mux.HandleFunc("GET /api/saves/{code}", store.get)
	mux.Handle("GET /", static)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("scb listening on %s (data: %s)", *addr, *dataDir)
	log.Fatal(srv.ListenAndServe())
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func probe(addr string) int {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 1
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	c := http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'")
		h.ServeHTTP(w, r)
	})
}

// ---------- static files ----------

type staticFile struct {
	body, gz []byte
	etag     string
	ctype    string
}

type staticHandler struct{ files map[string]*staticFile }

func newStaticHandler() (*staticHandler, error) {
	root, err := fs.Sub(webFS, "web")
	if err != nil {
		return nil, err
	}
	h := &staticHandler{files: map[string]*staticFile{}}
	err = fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		f := &staticFile{body: body, etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
		f.ctype = mime.TypeByExtension(path.Ext(p))
		if f.ctype == "" {
			f.ctype = http.DetectContentType(body)
		}
		if len(body) > 512 {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(body)
			zw.Close()
			if buf.Len() < len(body) {
				f.gz = buf.Bytes()
			}
		}
		h.files["/"+p] = f
		return nil
	})
	return h, err
}

func (h *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := path.Clean(r.URL.Path)
	if p == "/" {
		p = "/index.html"
	}
	f, ok := h.files[p]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", f.ctype)
	w.Header().Set("ETag", f.etag)
	// Revalidate every load so a new deploy is picked up immediately; unchanged files cost a 304.
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Vary", "Accept-Encoding")
	if r.Header.Get("If-None-Match") == f.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	body := f.body
	if f.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		body = f.gz
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(body)))
	w.Write(body)
}

// ---------- saves ----------

type saveRecord struct {
	Code      string          `json:"code"`
	UpdatedAt time.Time       `json:"updatedAt"`
	Data      json.RawMessage `json:"data"`
}

type saveStore struct {
	dir string
	mu  sync.Mutex // serialises writes so concurrent PUTs to one code can't interleave
}

func newSaveStore(dir string) (*saveStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &saveStore{dir: dir}, nil
}

func validCode(c string) bool {
	if len(c) != codeLen {
		return false
	}
	for _, r := range c {
		if !strings.ContainsRune(codeAlphabet, r) {
			return false
		}
	}
	return true
}

// normalizeCode accepts codes typed by people: lower case, spaces and dashes are fine.
func normalizeCode(c string) string {
	c = strings.ToUpper(c)
	c = strings.NewReplacer("-", "", " ", "").Replace(c)
	return c
}

func newCode() (string, error) {
	b := make([]byte, codeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, codeLen)
	for i, v := range b {
		// 256 % 31 bias is negligible for this purpose.
		out[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	return string(out), nil
}

func (s *saveStore) file(code string) string { return filepath.Join(s.dir, code+".json") }

func readBody(w http.ResponseWriter, r *http.Request) (json.RawMessage, error) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxSaveBytes+1024))
	if err != nil {
		return nil, errors.New("save too large")
	}
	var in struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &in); err != nil || len(in.Data) == 0 {
		return nil, errors.New(`body must be JSON: {"data": {...}}`)
	}
	if len(in.Data) > maxSaveBytes {
		return nil, errors.New("save too large")
	}
	var obj map[string]any
	if err := json.Unmarshal(in.Data, &obj); err != nil {
		return nil, errors.New("data must be a JSON object")
	}
	return in.Data, nil
}

func (s *saveStore) write(rec saveRecord) error {
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, "tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), s.file(rec.Code))
}

func (s *saveStore) create(w http.ResponseWriter, r *http.Request) {
	data, err := readBody(w, r)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var code string
	for i := 0; i < 10; i++ {
		c, err := newCode()
		if err != nil {
			httpError(w, http.StatusInternalServerError, "could not create code")
			return
		}
		if _, err := os.Stat(s.file(c)); errors.Is(err, fs.ErrNotExist) {
			code = c
			break
		}
	}
	if code == "" {
		httpError(w, http.StatusInternalServerError, "could not create code")
		return
	}
	rec := saveRecord{Code: code, UpdatedAt: time.Now().UTC(), Data: data}
	if err := s.write(rec); err != nil {
		log.Printf("write save: %v", err)
		httpError(w, http.StatusInternalServerError, "could not store save")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"code": rec.Code, "updatedAt": rec.UpdatedAt})
}

func (s *saveStore) update(w http.ResponseWriter, r *http.Request) {
	code := normalizeCode(r.PathValue("code"))
	if !validCode(code) {
		httpError(w, http.StatusBadRequest, "invalid save code")
		return
	}
	data, err := readBody(w, r)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Only existing codes can be updated, so clients can't pick their own codes.
	if _, err := os.Stat(s.file(code)); err != nil {
		httpError(w, http.StatusNotFound, "save code not found")
		return
	}
	rec := saveRecord{Code: code, UpdatedAt: time.Now().UTC(), Data: data}
	if err := s.write(rec); err != nil {
		log.Printf("write save: %v", err)
		httpError(w, http.StatusInternalServerError, "could not store save")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": rec.Code, "updatedAt": rec.UpdatedAt})
}

func (s *saveStore) get(w http.ResponseWriter, r *http.Request) {
	code := normalizeCode(r.PathValue("code"))
	if !validCode(code) {
		httpError(w, http.StatusBadRequest, "invalid save code")
		return
	}
	b, err := os.ReadFile(s.file(code))
	if err != nil {
		httpError(w, http.StatusNotFound, "save code not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ---------- rate limiting ----------

// rateLimiter allows `limit` write requests per client IP in each window.
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*bucket
}

type bucket struct {
	start time.Time
	n     int
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, hits: map[string]*bucket{}}
}

func clientIP(r *http.Request) string {
	// Trust X-Forwarded-For only from a loopback/private proxy (e.g. a reverse proxy on the Docker host).
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	return host
}

func (l *rateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if len(l.hits) > 10000 {
		for k, b := range l.hits {
			if now.Sub(b.start) > l.window {
				delete(l.hits, k)
			}
		}
	}
	b := l.hits[ip]
	if b == nil || now.Sub(b.start) > l.window {
		l.hits[ip] = &bucket{start: now, n: 1}
		return true
	}
	b.n++
	return b.n <= l.limit
}

func (l *rateLimiter) wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !l.allow(clientIP(r)) {
			httpError(w, http.StatusTooManyRequests, "too many saves, slow down")
			return
		}
		h(w, r)
	}
}
