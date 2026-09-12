package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRequestLimiterWindowsAndGlobalBudget(t *testing.T) {
	var limiter requestLimiter
	now := time.Now()
	for i := 0; i < 5; i++ {
		if limiter.allow("one", now, 5, 6, time.Minute) != 0 {
			t.Fatal("limited early")
		}
	}
	if retry := limiter.allow("one", now.Add(10*time.Second), 5, 6, time.Minute); retry != 50*time.Second {
		t.Fatalf("wrong retry: %v", retry)
	}
	if limiter.allow("two", now, 5, 6, time.Minute) != 0 {
		t.Fatal("per-IP limit affected another IP")
	}
	if limiter.allow("three", now, 5, 6, time.Minute) == 0 {
		t.Fatal("global budget bypassed")
	}
	if limiter.allow("one", now.Add(time.Minute), 5, 6, time.Minute) != 0 {
		t.Fatal("window did not reset")
	}
}

func TestRequestLimiterBoundsMemory(t *testing.T) {
	var limiter requestLimiter
	now := time.Now()
	for i := 0; i < 4096; i++ {
		if limiter.allow(fmt.Sprint(i), now, 1, 10000, time.Minute) != 0 {
			t.Fatal("limited before map capacity")
		}
	}
	if limiter.allow("overflow", now, 1, 10000, time.Minute) == 0 || len(limiter.byIP) != 4096 {
		t.Fatal("unbounded limiter map")
	}
	if limiter.allow("new", now.Add(time.Minute), 1, 10000, time.Minute) != 0 || len(limiter.byIP) != 1 {
		t.Fatal("expired entries not reclaimed")
	}
}

func TestRequestLimiterConcurrentAttempts(t *testing.T) {
	var limiter requestLimiter
	var allowed atomic.Int32
	var wg sync.WaitGroup
	now := time.Now()
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if limiter.allow("one", now, 5, 100, time.Minute) == 0 {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 5 {
		t.Fatalf("concurrent attempts bypassed limit: %d", allowed.Load())
	}
}

func TestLoginThrottlesPasswordGuesses(t *testing.T) {
	a := &app{password: "secret"}
	login := func(ip, password string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "https://fmert.me/stories-login", strings.NewReader("password="+password))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r.RemoteAddr = ip + ":4000"
		w := httptest.NewRecorder()
		a.login(w, r)
		return w
	}
	for i := 0; i < 5; i++ {
		if w := login("198.51.100.12", "wrong"); w.Code != http.StatusSeeOther {
			t.Fatal("unexpected login response")
		}
	}
	w := login("198.51.100.12", "secret")
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" || len(w.Result().Cookies()) != 0 {
		t.Fatal("throttled request reached authentication")
	}
	if w := login("198.51.100.13", "secret"); w.Code != http.StatusSeeOther || len(w.Result().Cookies()) != 1 {
		t.Fatal("normal login broken")
	}
	// Expired windows must allow access again without a process restart.
	a.loginLimiter.byIP["198.51.100.12"] = requestWindow{started: time.Now().Add(-16 * time.Minute), count: 5}
	if w := login("198.51.100.12", "secret"); len(w.Result().Cookies()) != 1 {
		t.Fatal("login did not recover")
	}
}

func submitVisit(a *app, ip, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "https://fmert.me/stories-api/analytics/visit", strings.NewReader(`{"path":"/posts/example/","referrer":""}`))
	r.Header.Set("Origin", origin)
	r.RemoteAddr = ip + ":4000"
	w := httptest.NewRecorder()
	a.recordVisit(w, r)
	return w
}

func TestAnalyticsThrottlesWithoutWritingRejectedVisits(t *testing.T) {
	a := &app{dataDir: t.TempDir()}
	for i := 0; i < 60; i++ {
		if w := submitVisit(a, "198.51.100.12", "https://fmert.me"); w.Code != http.StatusNoContent {
			t.Fatalf("visit failed: %d", w.Code)
		}
	}
	w := submitVisit(a, "198.51.100.12", "https://fmert.me")
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") == "" {
		t.Fatal("analytics per-IP limit bypassed")
	}
	files, _ := filepath.Glob(filepath.Join(a.dataDir, "analytics", "*.jsonl"))
	var lines int
	for _, file := range files {
		b, _ := os.ReadFile(file)
		lines += strings.Count(string(b), "\n")
	}
	if lines != 60 {
		t.Fatalf("rejected visit written: %d", lines)
	}
	// Rotating addresses cannot bypass the endpoint's total request budget.
	a.visitLimiter.global = requestWindow{started: time.Now(), count: 600}
	if w := submitVisit(a, "198.51.100.13", "https://fmert.me"); w.Code != http.StatusTooManyRequests {
		t.Fatal("global analytics limit bypassed")
	}
}

func TestAnalyticsRejectsUntrustedOrigins(t *testing.T) {
	a := &app{dataDir: t.TempDir()}
	for _, origin := range []string{"", "null", "https://evil.example"} {
		if w := submitVisit(a, "198.51.100.12", origin); w.Code != http.StatusForbidden {
			t.Fatalf("accepted origin %q", origin)
		}
	}
	if _, err := os.Stat(filepath.Join(a.dataDir, "analytics")); !os.IsNotExist(err) {
		t.Fatal("invalid requests created analytics storage")
	}
}

func sparseAnalyticsFile(t *testing.T, dir, name string, size int64) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "analytics"), 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "analytics", name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := file.Truncate(size); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAnalyticsStorageCapsSurviveRestart(t *testing.T) {
	for _, test := range []struct {
		name string
		file string
		size int64
	}{
		{"daily", time.Now().UTC().Format("2006-01-02") + ".jsonl", maxAnalyticsDayBytes},
		{"total", "2000-01-01.jsonl", maxAnalyticsTotalBytes},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			path := sparseAnalyticsFile(t, dir, test.file, test.size)
			for i := 0; i < 2; i++ {
				a := &app{dataDir: dir}
				if w := submitVisit(a, "198.51.100.12", "https://fmert.me"); w.Code != http.StatusServiceUnavailable {
					t.Fatalf("storage cap bypassed: %d", w.Code)
				}
			}
			info, _ := os.Stat(path)
			if info.Size() != test.size {
				t.Fatal("full log grew")
			}
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if w := submitVisit(&app{dataDir: dir}, "198.51.100.12", "https://fmert.me"); w.Code != http.StatusNoContent {
				t.Fatal("logging did not recover after space was freed")
			}
		})
	}
}
