package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func likesTestApp(t *testing.T) *app {
	t.Helper()
	return &app{dataDir: t.TempDir(), password: "secret", targets: []LikeTarget{{Kind: "post", ID: "/posts/example/", Title: "Example"}}, targetsUpdated: time.Now()}
}

func sendLike(a *app, cookie *http.Cookie, kind, id string, liked bool) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]any{"kind": kind, "id": id, "liked": liked, "referrer": "https://example.org/article?private=value"})
	r := httptest.NewRequest("POST", "https://fmert.me/stories-api/likes", strings.NewReader(string(body)))
	r.Header.Set("Origin", "https://fmert.me")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("User-Agent", "Mozilla/5.0 (iPhone) Mobile Safari/604.1")
	r.RemoteAddr = "198.51.100.12:4000"
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.setLike(w, r)
	return w
}

func assertLikeState(t *testing.T, response *httptest.ResponseRecorder, count int, liked bool) {
	t.Helper()
	var state LikeState
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &state) != nil || state.Count != count || state.Liked != liked {
		t.Fatalf("expected %d/%t; received %d %s", count, liked, response.Code, response.Body.String())
	}
	var fields map[string]any
	json.Unmarshal(response.Body.Bytes(), &fields)
	if len(fields) != 2 || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("public response leaked fields or was cacheable")
	}
}

func TestLikesIdempotencePersistenceAndUndo(t *testing.T) {
	a := likesTestApp(t)
	first := sendLike(a, nil, "post", "/posts/example/", true)
	assertLikeState(t, first, 1, true)
	cookie := first.Result().Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("like cookie must be protected")
	}
	assertLikeState(t, sendLike(a, cookie, "post", "/posts/example/", true), 1, true)
	// Two browsers sharing a public IP must still be able to like independently.
	assertLikeState(t, sendLike(a, nil, "post", "/posts/example/", true), 2, true)
	summary, err := a.likesSummary()
	if err != nil || summary.Total != 2 || len(summary.Recent) != 2 {
		t.Fatalf("invalid summary: %+v %v", summary, err)
	}
	row := summary.Recent[0]
	if row.IP != "198.51.100.12" || row.Path != "/posts/example/" || row.Device != "Mobil" || row.Browser != "Safari" || row.Referrer != "example.org" || row.Title != "Example" || row.Time == "" {
		t.Fatalf("missing like metadata: %+v", row)
	}
	b, _ := os.ReadFile(a.likePath("post", "/posts/example/"))
	if strings.Contains(string(b), cookie.Value) || strings.Contains(string(b), "private=value") {
		t.Fatal("stored cookie secret or referrer query")
	}
	// A fresh process must recover counts and the visitor's liked state.
	restarted := &app{dataDir: a.dataDir, password: a.password}
	r := httptest.NewRequest("GET", "https://fmert.me/stories-api/likes?kind=post&id=/posts/example/", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	restarted.getLikes(w, r)
	assertLikeState(t, w, 2, true)
	assertLikeState(t, sendLike(restarted, cookie, "post", "/posts/example/", false), 1, false)
	assertLikeState(t, sendLike(restarted, cookie, "post", "/posts/example/", false), 1, false)
	summary, err = restarted.likesSummary()
	if err != nil || summary.Total != 1 {
		t.Fatal("unlike did not remove its record")
	}
}

func TestLikeDetailsRequireAdminSession(t *testing.T) {
	a := likesTestApp(t)
	assertLikeState(t, sendLike(a, nil, "post", "/posts/example/", true), 1, true)
	r := httptest.NewRequest("GET", "/stories-admin?tab=analytics", nil)
	w := httptest.NewRecorder()
	a.admin(w, r)
	if strings.Contains(w.Body.String(), "198.51.100.12") {
		t.Fatal("like details visible without login")
	}
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w = httptest.NewRecorder()
	a.admin(w, r)
	if !strings.Contains(w.Body.String(), "198.51.100.12") || !strings.Contains(w.Body.String(), "example.org") {
		t.Fatal("authenticated analytics missing like details")
	}
	if strings.Contains(w.Body.String(), "var form=document.getElementById('story-form')") {
		t.Fatal("analytics rendered the story editor script")
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private panel must not be cached")
	}
}

func TestLikesValidateOriginAndContent(t *testing.T) {
	a := likesTestApp(t)
	for _, origin := range []string{"", "https://evil.example", "null"} {
		r := httptest.NewRequest("POST", "https://fmert.me/stories-api/likes", strings.NewReader(`{"kind":"post","id":"/posts/example/","liked":true}`))
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		a.setLike(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("accepted origin %q", origin)
		}
	}
	if w := sendLike(a, nil, "post", "/posts/missing/", true); w.Code != http.StatusNotFound {
		t.Fatalf("accepted nonexistent post: %d", w.Code)
	}
	if w := sendLike(a, nil, "story", "../private", true); w.Code != http.StatusBadRequest {
		t.Fatal("accepted traversal target")
	}
	r := httptest.NewRequest("POST", "https://fmert.me/stories-api/likes", strings.NewReader(`{"kind":"post","id":"/posts/example/"}`))
	r.Header.Set("Origin", "https://fmert.me")
	w := httptest.NewRecorder()
	a.setLike(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatal("missing liked state accepted")
	}
}

func TestLikesPublishedManifestAndLiveStories(t *testing.T) {
	a := &app{dataDir: t.TempDir(), password: "secret"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/like-targets.json" {
			http.NotFound(w, r)
			return
		}
		ioBody := `[{"kind":"post","id":"/posts/example/","title":"Published post"},{"kind":"story","id":"fallback","title":"Fallback story"}]`
		w.Write([]byte(ioBody))
	}))
	defer server.Close()
	t.Setenv("BLOG_ORIGIN", server.URL)
	assertLikeState(t, sendLike(a, nil, "post", "/posts/example/", true), 1, true)
	assertLikeState(t, sendLike(a, nil, "story", "fallback", true), 1, true)
	if err := a.saveUnlocked([]Story{{ID: "live-story", Type: "text", Text: "Live story"}}); err != nil {
		t.Fatal(err)
	}
	assertLikeState(t, sendLike(a, nil, "story", "live-story", true), 1, true)
}

func TestConcurrentLikesDoNotLoseCounts(t *testing.T) {
	a := likesTestApp(t)
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if response := sendLike(a, nil, "post", "/posts/example/", true); response.Code != http.StatusOK {
				t.Errorf("like failed: %s", response.Body.String())
			}
		}()
	}
	wg.Wait()
	summary, err := a.likesSummary()
	if err != nil || summary.Total != 12 {
		t.Fatalf("lost concurrent likes: %d, %v", summary.Total, err)
	}
}

func TestDockerProxyIPTrust(t *testing.T) {
	r := httptest.NewRequest("POST", "/stories-api/likes", nil)
	r.RemoteAddr = "172.18.0.1:4000"
	r.Header.Set("X-Forwarded-For", "192.0.2.99, 198.51.100.12")
	t.Setenv("TRUST_PROXY_HEADERS", "")
	if clientIP(r) != "172.18.0.1" {
		t.Fatal("trusted unconfigured proxy")
	}
	t.Setenv("TRUST_PROXY_HEADERS", "true")
	if clientIP(r) != "198.51.100.12" {
		t.Fatal("did not use the Caddy-appended client IP")
	}
}

func TestLikesRateLimitAndRecovery(t *testing.T) {
	a := likesTestApp(t)
	now := time.Now()
	for i := 0; i < 60; i++ {
		if !a.allowLike("198.51.100.12", now) {
			t.Fatal("limited too early")
		}
	}
	response := sendLike(a, nil, "post", "/posts/example/", true)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") == "" {
		t.Fatal("write rate limit not enforced")
	}
	if !a.allowLike("198.51.100.12", now.Add(time.Minute)) {
		t.Fatal("limit did not reset")
	}
}
