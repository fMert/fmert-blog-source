package main

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func TestDeleteKeepsImageWhenStorySaveFails(t *testing.T) {
	dir := t.TempDir()
	a := &app{dataDir: dir, password: "secret"}
	if err := os.Mkdir(filepath.Join(dir, "media"), 0755); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(dir, "media", "story.png")
	if err := os.WriteFile(image, []byte("image"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := a.saveUnlocked([]Story{{ID: "story", Type: "image", Image: "/story-media/story.png", Text: "story"}}); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "stories.json.tmp"), 0755); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/stories-api/delete", strings.NewReader("id=story"))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()
	a.delete(w, r)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected save failure, got %d", w.Code)
	}
	if _, err := os.Stat(image); err != nil {
		t.Fatalf("image disappeared after failed save: %v", err)
	}
}

func TestPostSlugUsesPublisherAlphabet(t *testing.T) {
	if got := slugify("Plan ١ ve 2"); got != "plan-ve-2" {
		t.Fatalf("unexpected slug %q", got)
	}
	if got := slugify("Ĉu ĝojaj ŝafoj ĵus venis?"); got != "cu-gojaj-safoj-jus-venis" {
		t.Fatalf("unexpected Esperanto slug %q", got)
	}
}

func TestPostFilenameAvoidsEveryLanguageAndLegacy(t *testing.T) {
	dir := t.TempDir()
	for i, language := range []string{"", "eo", "en", "tr"} {
		path := filepath.Join(dir, language)
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
		name := "2026-11-04-example.md"
		if i > 0 {
			name = fmt.Sprintf("2026-11-04-example-%d.md", i+1)
		}
		if err := os.WriteFile(filepath.Join(path, name), []byte("post"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	filename, err := uniquePostFilename(dir, "2026-11-07", "example", map[string]bool{})
	if err != nil || filename != "2026-11-07-example-5.md" {
		t.Fatalf("unexpected filename %q: %v", filename, err)
	}
}

func TestPostMetadataUsesSelectedLanguage(t *testing.T) {
	a := &app{password: "secret"}
	values := url.Values{"title": {"Ĉefa ŝanĝo"}, "body": {"Nova programo"}, "title_tr": {"Yeni proje"}, "body_tr": {"Bu proje yenilendi"}, "lang": {"eo"}}
	r := httptest.NewRequest("POST", "/stories-api/posts/metadata", strings.NewReader(values.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()
	a.postMetadata(w, r)
	var metadata PostMetadata
	if w.Code != http.StatusOK || json.NewDecoder(w.Body).Decode(&metadata) != nil {
		t.Fatalf("metadata request failed: %d %s", w.Code, w.Body.String())
	}
	if metadata.Category != "Projekto" || metadata.Slug != "cefa-sango" {
		t.Fatalf("unexpected localized metadata: %+v", metadata)
	}
}

func TestLocalizedStoriesKeepLegacyTurkishOnly(t *testing.T) {
	stories := []Story{
		{ID: "old", Text: "Eski"},
		{ID: "new", Text: "Nova", Link: "/posts/example/", Translations: map[string]StoryTranslation{
			"en": {Text: "New"}, "tr": {Text: "Yeni"},
		}},
	}
	english := localizedStories(stories, "en")
	if len(english) != 1 || english[0].Text != "New" || english[0].Link != "/en/posts/example/" {
		t.Fatalf("unexpected English stories: %+v", english)
	}
	esperanto := localizedStories(stories, "eo")
	if len(esperanto) != 1 || esperanto[0].Text != "Nova" {
		t.Fatalf("unexpected Esperanto stories: %+v", esperanto)
	}
	turkish := localizedStories(stories, "tr")
	if len(turkish) != 2 || turkish[1].Text != "Yeni" || turkish[1].Link != "/tr/posts/example/" {
		t.Fatalf("unexpected Turkish stories: %+v", turkish)
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
	stubPostInventory(t, nil)
	dataDir := t.TempDir()
	a := &app{dataDir: dataDir, password: "secret"}
	values := url.Values{
		"title":    {"Terminal için küçük bir proje"},
		"body":     {"## Merhaba\n\nBu proje Linux terminalinde çalışıyor."},
		"title_en": {"A small terminal project"}, "body_en": {"## Hello\n\nThis project runs on Linux."},
		"title_tr": {"Terminal için küçük bir proje"}, "body_tr": {"## Merhaba\n\nBu proje Linux terminalinde çalışıyor."},
	}
	r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()

	a.createPost(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("create post returned %d: %s", w.Code, w.Body.String())
	}
	var result struct {
		ID, File, URL string
		Metadata      PostMetadata
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Metadata.Slug != "terminal-icin-kucuk-bir-proje" || result.URL != "/posts/"+result.Metadata.Slug+"/" || result.URL != postURL(result.File) {
		t.Fatalf("inconsistent response: %+v", result)
	}
	postsDir := filepath.Join(dataDir, "posts")
	trigger, err := os.ReadFile(filepath.Join(postsDir, ".publish-jobs", result.ID, "request"))
	if err != nil {
		t.Fatalf("publish trigger missing: %v", err)
	}
	filename := strings.TrimSpace(string(trigger))
	if !strings.HasSuffix(filename, "-terminal-icin-kucuk-bir-proje.md") {
		t.Fatalf("unexpected post filename: %s", filename)
	}
	markdown, err := os.ReadFile(filepath.Join(postsDir, "eo", filename))
	if err != nil {
		t.Fatalf("post file missing: %v", err)
	}
	content := string(markdown)
	for _, expected := range []string{`title: "Terminal için küçük bir proje"`, `categories: ["Projekto"]`, `tags: ["linux", "terminal"`, `render_with_liquid: false`, `## Merhaba`} {
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
	stubPostInventory(t, map[string]string{
		"/like-targets.json": `[{"kind":"post","id":"/posts/teknofest-2026-finali/","title":"Source post"}]`,
	})
	dataDir := t.TempDir()
	a := &app{dataDir: dataDir, password: "secret"}
	values := url.Values{"title": {"TEKNOFEST 2026 finali"}, "body": {"La sama afiŝo estos reprovitaj."}, "title_en": {"TEKNOFEST 2026 final"}, "body_en": {"The same post will be retried."}, "title_tr": {"TEKNOFEST 2026 finali"}, "body_tr": {"Aynı yazı yeniden denenecek."}}

	create := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
		w := httptest.NewRecorder()
		a.createPost(w, r)
		if w.Code == http.StatusOK && !strings.Contains(w.Body.String(), `"slug":"teknofest-2026-finali-2"`) {
			t.Fatalf("expected the reserved slug in the response: %s", w.Body.String())
		}
		return w
	}

	first := create()
	if first.Code != http.StatusOK {
		t.Fatalf("first create returned %d: %s", first.Code, first.Body.String())
	}
	var result PostPublishStatus
	if err := json.Unmarshal(first.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	postsDir := filepath.Join(dataDir, "posts")
	statusPath := filepath.Join(postsDir, ".publish-jobs", result.ID, "status")
	result.State = "failed"
	if err := writeJSONAtomic(statusPath, result); err != nil {
		t.Fatal(err)
	}
	values.Set("retry_id", result.ID)
	retry := create()
	if retry.Code != http.StatusOK {
		t.Fatalf("retry returned %d: %s", retry.Code, retry.Body.String())
	}
	var retried PostPublishStatus
	if err := json.Unmarshal(retry.Body.Bytes(), &retried); err != nil {
		t.Fatal(err)
	}
	if !validPublishID(retried.ID) || retried.ID == result.ID || retried.File != result.File {
		t.Fatalf("retry must use a new operation for the same file: %+v / %+v", result, retried)
	}
	previous, err := os.ReadFile(statusPath)
	if err != nil || !strings.Contains(string(previous), `"state":"failed"`) {
		t.Fatalf("retry overwrote the original result: %s, %v", previous, err)
	}
	posts, err := filepath.Glob(filepath.Join(postsDir, "eo", "*.md"))
	if err != nil || len(posts) != 1 {
		t.Fatalf("retry created duplicate posts: %v (err=%v)", posts, err)
	}
}

func TestCreatePostPublishesAllThreeLanguages(t *testing.T) {
	stubPostInventory(t, nil)
	dataDir := t.TempDir()
	a := &app{dataDir: dataDir, password: "secret"}
	values := url.Values{
		"title": {"Nova projekto"}, "body": {"La projekto funkcias."},
		"title_en": {"New project"}, "body_en": {"The project works."},
		"title_tr": {"Yeni proje"}, "body_tr": {"Bu proje çalışıyor."},
	}
	r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()
	a.createPost(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("create post returned %d: %s", w.Code, w.Body.String())
	}
	var result PostPublishStatus
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	trigger, err := os.ReadFile(filepath.Join(dataDir, "posts", ".publish-jobs", result.ID, "request"))
	if err != nil {
		t.Fatal(err)
	}
	filename := strings.TrimSpace(string(trigger))
	for language, expected := range map[string]string{"eo": "La projekto funkcias.", "en": "The project works.", "tr": "Bu proje çalışıyor."} {
		content, err := os.ReadFile(filepath.Join(dataDir, "posts", language, filename))
		if err != nil || !strings.Contains(string(content), expected) {
			t.Fatalf("%s translation missing: %v", language, err)
		}
	}
}

func stubPostInventory(t *testing.T, manifests map[string]string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/like-targets.json" && r.URL.Path != "/en/like-targets.json" && r.URL.Path != "/tr/like-targets.json" {
			http.NotFound(w, r)
			return
		}
		body, ok := manifests[r.URL.Path]
		if !ok {
			body = "[]"
		}
		fmt.Fprint(w, body)
	}))
	t.Cleanup(server.Close)
	t.Setenv("BLOG_ORIGIN", server.URL)
}

func TestCreatePostReservesURLsAcrossLanguagesAndConcurrentRequests(t *testing.T) {
	for _, prefix := range []string{"", "/en", "/tr"} {
		t.Run("source="+prefix, func(t *testing.T) {
			stubPostInventory(t, map[string]string{
				prefix + "/like-targets.json": `[{"kind":"post","id":"/posts/example/","title":"Source post"}]`,
			})
			a := &app{dataDir: t.TempDir(), password: "secret"}
			values := url.Values{
				"title": {"Example"}, "body": {"Body"},
				"title_en": {"English title"}, "body_en": {"English body"},
				"title_tr": {"Türkçe başlık"}, "body_tr": {"Türkçe içerik"},
			}
			start := make(chan struct{})
			results := make(chan *httptest.ResponseRecorder, 2)
			for i := 0; i < 2; i++ {
				go func() {
					<-start
					r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
					r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
					r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
					w := httptest.NewRecorder()
					a.createPost(w, r)
					results <- w
				}()
			}
			close(start)
			seen := make(map[string]bool)
			for i := 0; i < 2; i++ {
				w := <-results
				var result struct {
					ID, File, URL string
					Metadata      PostMetadata
				}
				if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &result) != nil {
					t.Fatalf("create failed: %d %s", w.Code, w.Body.String())
				}
				if seen[result.URL] || (result.URL != "/posts/example-2/" && result.URL != "/posts/example-3/") {
					t.Fatalf("unexpected or duplicate URL: %s", result.URL)
				}
				seen[result.URL] = true
				if result.URL != "/posts/"+result.Metadata.Slug+"/" || postURL(result.File) != result.URL {
					t.Fatalf("inconsistent response: %+v", result)
				}
				for _, language := range []string{"eo", "en", "tr"} {
					posts, err := a.loadManagedPosts(language)
					if err != nil {
						t.Fatal(err)
					}
					found := false
					for _, post := range posts {
						if post.File == result.File && strings.HasSuffix(post.URL, result.URL) {
							found = true
						}
					}
					if !found {
						t.Fatalf("%s output missing for %+v", language, result)
					}
				}
			}
		})
	}
}

func TestCreatePostRejectsUnavailableInventory(t *testing.T) {
	for _, tc := range []struct {
		body   string
		status int
	}{
		{"", 200}, {"null", 200}, {"{}", 200}, {"[{}]", 200}, {"[{", 200}, {"[] garbage", 200},
		{"[]", 404}, {"[]", 503}, {"offline", 0},
	} {
		t.Run(fmt.Sprintf("%d/%s", tc.status, tc.body), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/tr/like-targets.json" {
					w.WriteHeader(tc.status)
					fmt.Fprint(w, tc.body)
					return
				}
				fmt.Fprint(w, "[]")
			}))
			t.Cleanup(server.Close)
			t.Setenv("BLOG_ORIGIN", server.URL)
			if tc.status == 0 {
				server.Close()
			}
			a := &app{dataDir: t.TempDir(), password: "secret"}
			values := url.Values{"title": {"Example"}, "body": {"Body"}, "title_en": {"Example"}, "body_en": {"Body"}, "title_tr": {"Example"}, "body_tr": {"Body"}}
			request := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			request.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
			w := httptest.NewRecorder()
			a.createPost(w, request)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected unavailable inventory, got %d: %s", w.Code, w.Body.String())
			}
			for _, language := range []string{"eo", "en", "tr"} {
				posts, err := a.loadManagedPosts(language)
				if err != nil || len(posts) != 0 {
					t.Fatalf("unexpected %s posts: %+v, %v", language, posts, err)
				}
			}
			if _, err := os.Stat(filepath.Join(a.postsDir(), ".publish-jobs")); !os.IsNotExist(err) {
				t.Fatalf("publish was triggered: %v", err)
			}
		})
	}
}
