package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestPublishQueueAtomicAndIndependent(t *testing.T) {
	posts := t.TempDir()
	const filename = "2026-11-07-example.md"
	var wg sync.WaitGroup
	ids := make(chan string, 20)
	for i := 0; i < cap(ids); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := enqueuePost(posts, filename)
			if err != nil {
				t.Error(err)
				return
			}
			ids <- id
		}()
	}
	wg.Wait()
	close(ids)
	seen := map[string]bool{}
	for id := range ids {
		if !validPublishID(id) || seen[id] {
			t.Fatalf("invalid or reused operation ID: %q", id)
		}
		seen[id] = true
		job := filepath.Join(posts, ".publish-jobs", id)
		request, err := os.ReadFile(filepath.Join(job, "request"))
		if err != nil || string(request) != filename+"\n" {
			t.Fatalf("incomplete accepted request: %q, %v", request, err)
		}
		data, err := os.ReadFile(filepath.Join(job, "status"))
		var status PostPublishStatus
		if err != nil || json.Unmarshal(data, &status) != nil || status.ID != id || status.State != "queued" || status.File != filename {
			t.Fatalf("incomplete accepted status: %s, %v", data, err)
		}
	}
	if len(seen) != cap(ids) {
		t.Fatalf("lost accepted requests: %d", len(seen))
	}
	staging, _ := filepath.Glob(filepath.Join(posts, ".publish-request-*"))
	if len(staging) != 0 {
		t.Fatalf("staging directories left behind: %v", staging)
	}
}

func TestPostStatusIdentityAndAuthorization(t *testing.T) {
	a := &app{dataDir: t.TempDir(), password: "secret"}
	first, err := enqueuePost(a.postsDir(), "2026-11-07-example.md")
	if err != nil {
		t.Fatal(err)
	}
	second, err := enqueuePost(a.postsDir(), "2026-11-07-example.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSONAtomic(filepath.Join(a.postsDir(), ".publish-jobs", first, "status"), PostPublishStatus{ID: first, State: "published"}); err != nil {
		t.Fatal(err)
	}
	// A new app instance must find the same queued operation after restart.
	a = &app{dataDir: a.dataDir, password: a.password}
	for _, tc := range []struct {
		id    string
		auth  bool
		code  int
		state string
	}{
		{first, true, 200, "published"}, {second, true, 200, "queued"},
		{first, false, 401, ""}, {"../.publish-status", false, 401, ""},
		{"", true, 400, ""}, {"../.publish-status", true, 400, ""},
		{strings.Repeat("A", 32), true, 400, ""}, {strings.Repeat("g", 32), true, 400, ""},
		{first + "/request", true, 400, ""}, {strings.Repeat("0", 32), true, 404, ""},
	} {
		r := httptest.NewRequest("GET", "/stories-api/posts/status?id="+url.QueryEscape(tc.id), nil)
		if tc.auth {
			r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
		}
		w := httptest.NewRecorder()
		a.postStatus(w, r)
		if w.Code != tc.code {
			t.Fatalf("id=%q auth=%v: got %d, want %d", tc.id, tc.auth, w.Code, tc.code)
		}
		if tc.code == 200 {
			var status PostPublishStatus
			if json.Unmarshal(w.Body.Bytes(), &status) != nil || status.ID != tc.id || status.State != tc.state {
				t.Fatalf("wrong operation returned: %s", w.Body.String())
			}
		}
	}
}

func TestCreatePostRejectsFailedAcceptance(t *testing.T) {
	stubPostInventory(t, nil)
	a := &app{dataDir: t.TempDir(), password: "secret"}
	if err := os.MkdirAll(a.postsDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a.postsDir(), ".publish-jobs"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	values := url.Values{"title": {"Example"}, "body": {"body"}, "title_en": {"Example"}, "body_en": {"body"}, "title_tr": {"Example"}, "body_tr": {"body"}}
	r := httptest.NewRequest("POST", "/stories-api/posts", strings.NewReader(values.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "story_session", Value: a.sessionToken()})
	w := httptest.NewRecorder()
	a.createPost(w, r)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("failed queue write accepted: %d", w.Code)
	}
	files, _ := filepath.Glob(filepath.Join(a.postsDir(), "*", "*.md"))
	if len(files) != 0 {
		t.Fatalf("rejected post files left behind: %v", files)
	}
}
