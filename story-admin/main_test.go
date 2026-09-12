package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidationAndImage(t *testing.T) {
	if validate(Story{Type: "text", Text: "hello"}) != nil {
		t.Fatal("valid text story rejected")
	}
	if validate(Story{Type: "text", Text: "hello", Link: "javascript:alert(1)"}) == nil {
		t.Fatal("unsafe link accepted")
	}
	if validate(Story{Type: "text", Text: "hello", Link: "//evil.example"}) == nil {
		t.Fatal("protocol-relative link accepted")
	}
	dir := t.TempDir()
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 504)...)
	ext, err := saveImage(dir, "test", bytes.NewReader(png), int64(len(png)))
	if err != nil || ext != ".png" {
		t.Fatalf("PNG rejected: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "test.png")); err != nil {
		t.Fatal("PNG was not saved")
	}
}

func TestSession(t *testing.T) {
	a := &app{password: "secret"}
	r := httptest.NewRequest("GET", "/stories-admin", nil)
	if a.authorized(r) {
		t.Fatal("request without a session was authorized")
	}
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	if !a.authorized(r) {
		t.Fatal("valid session was rejected")
	}
}

func TestAdminPageIncludesComposerAndPreview(t *testing.T) {
	a := &app{dataDir: t.TempDir(), password: "secret"}
	r := httptest.NewRequest("GET", "/stories-admin", nil)
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()

	a.admin(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("admin page returned %d", w.Code)
	}
	body := w.Body.String()
	for _, expected := range []string{`id="story-form"`, `id="preview"`, `Canlı önizleme`, `Yayınlanan hikâyeler`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("admin page is missing %q", expected)
		}
	}
}

func TestAdminPostsTabIncludesMarkdownEditor(t *testing.T) {
	a := &app{dataDir: t.TempDir(), password: "secret"}
	r := httptest.NewRequest("GET", "/stories-admin?tab=posts", nil)
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()

	a.admin(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("posts tab returned %d", w.Code)
	}
	body := w.Body.String()
	for _, expected := range []string{`id="post-form"`, `action="/stories-api/posts"`, `id="post-body"`, `Markdown ile yaz`, `Tarih, bağlantı, kategori ve etiketler`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("posts tab is missing %q", expected)
		}
	}
	if strings.Contains(body, `id="story-form"`) {
		t.Fatal("posts tab rendered the story form")
	}
}

func TestAnalyticsVisitAndProtectedTab(t *testing.T) {
	a := &app{dataDir: t.TempDir(), password: "secret"}
	r := httptest.NewRequest("POST", "/stories-api/analytics/visit", strings.NewReader(`{"path":"/posts/example/","referrer":"https://example.org/article"}`))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Origin", "http://example.com")
	r.Header.Set("X-Forwarded-For", "198.51.100.12")
	r.Header.Set("User-Agent", "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Safari/604.1")
	w := httptest.NewRecorder()
	a.recordVisit(w, r)
	if w.Code != http.StatusNoContent {
		t.Fatalf("visit returned %d: %s", w.Code, w.Body.String())
	}
	summary, err := a.analyticsSummary()
	if err != nil || summary.Views != 1 || summary.UniqueIPs != 1 || summary.Recent[0].IP != "198.51.100.12" || summary.Devices[0].Name != "Mobil" {
		t.Fatalf("unexpected analytics: %+v, %v", summary, err)
	}
	adminRequest := httptest.NewRequest("GET", "/stories-admin?tab=analytics", nil)
	w = httptest.NewRecorder()
	a.admin(w, adminRequest)
	if strings.Contains(w.Body.String(), "198.51.100.12") {
		t.Fatal("IP shown without authentication")
	}
	adminRequest.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w = httptest.NewRecorder()
	a.admin(w, adminRequest)
	if !strings.Contains(w.Body.String(), "198.51.100.12") || !strings.Contains(w.Body.String(), "En çok görüntülenen") {
		t.Fatal("analytics tab missing visit data")
	}
}

func TestInferPostMetadata(t *testing.T) {
	metadata := inferPostMetadata("Python ile yapay zekâ uygulaması", "Linux üzerinde bir API ve LLM projesi geliştirdim.")
	if metadata.Slug != "python-ile-yapay-zeka-uygulamasi" {
		t.Fatalf("unexpected slug: %s", metadata.Slug)
	}
	if metadata.Category != "Proje" {
		t.Fatalf("unexpected category: %s", metadata.Category)
	}
	tags := strings.Join(metadata.Tags, ",")
	if !strings.Contains(tags, "yapay-zeka") || !strings.Contains(tags, "python") || !strings.Contains(tags, "linux") {
		t.Fatalf("expected automatic tags, got %v", metadata.Tags)
	}
}

func TestCreatePostWritesMarkdownAndPublishTrigger(t *testing.T) {
	dataDir := t.TempDir()
	a := &app{dataDir: dataDir, password: "secret"}
	values := url.Values{
		"title": {"Terminal için küçük bir proje"},
		"body":  {"## Merhaba\n\nBu proje Linux terminalinde çalışıyor."},
	}
	r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()

	a.createPost(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("create post returned %d: %s", w.Code, w.Body.String())
	}
	postsDir := filepath.Join(dataDir, "posts")
	trigger, err := os.ReadFile(filepath.Join(postsDir, ".publish-trigger"))
	if err != nil {
		t.Fatalf("publish trigger missing: %v", err)
	}
	filename := strings.TrimSpace(string(trigger))
	if !strings.HasSuffix(filename, "-terminal-icin-kucuk-bir-proje.md") {
		t.Fatalf("unexpected post filename: %s", filename)
	}
	markdown, err := os.ReadFile(filepath.Join(postsDir, filename))
	if err != nil {
		t.Fatalf("post file missing: %v", err)
	}
	content := string(markdown)
	for _, expected := range []string{`title: "Terminal için küçük bir proje"`, `categories: ["Proje"]`, `tags: ["linux", "terminal"`, `render_with_liquid: false`, `## Merhaba`} {
		if !strings.Contains(content, expected) {
			t.Fatalf("post file is missing %q:\n%s", expected, content)
		}
	}
}

func TestPostMetadataListsAlwaysQuoteNumericTags(t *testing.T) {
	metadata := inferPostMetadata("TEKNOFEST 2026 finali", "Takımımız finale kaldı.")
	frontMatter := yamlStringList(metadata.Tags)
	if !strings.Contains(frontMatter, `"2026"`) {
		t.Fatalf("numeric-looking tag was not quoted: %s", frontMatter)
	}
}

func TestCreatePostRetriesFailedFileWithoutDuplicate(t *testing.T) {
	dataDir := t.TempDir()
	a := &app{dataDir: dataDir, password: "secret"}
	values := url.Values{"title": {"TEKNOFEST 2026 finali"}, "body": {"Aynı yazı yeniden denenecek."}}

	create := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
		w := httptest.NewRecorder()
		a.createPost(w, r)
		return w
	}

	if w := create(); w.Code != http.StatusOK {
		t.Fatalf("first create returned %d: %s", w.Code, w.Body.String())
	}
	postsDir := filepath.Join(dataDir, "posts")
	trigger, err := os.ReadFile(filepath.Join(postsDir, ".publish-trigger"))
	if err != nil {
		t.Fatal(err)
	}
	filename := strings.TrimSpace(string(trigger))
	if err := writeJSONAtomic(filepath.Join(postsDir, ".publish-status"), PostPublishStatus{State: "failed", File: filename}); err != nil {
		t.Fatal(err)
	}
	if w := create(); w.Code != http.StatusOK {
		t.Fatalf("retry returned %d: %s", w.Code, w.Body.String())
	}
	posts, err := filepath.Glob(filepath.Join(postsDir, "*.md"))
	if err != nil || len(posts) != 1 {
		t.Fatalf("retry created duplicate posts: %v (err=%v)", posts, err)
	}
}
