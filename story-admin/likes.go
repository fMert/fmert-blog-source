package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type LikeTarget struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Title string `json:"title"`
}

type ContentLikes struct {
	LikeTarget
	Visitors map[string]Visit `json:"visitors"`
}

type LikeRow struct {
	LikeTarget
	Visit
}

type LikedContent struct {
	LikeTarget
	Count int
}

type LikesSummary struct {
	Total   int
	Content []LikedContent
	Recent  []LikeRow
}

// The public response deliberately contains no visitor details or identifiers.
type LikeState struct {
	Count int  `json:"count"`
	Liked bool `json:"liked"`
}

type likeWindow struct {
	Started  time.Time
	Requests int
}

// Bound anonymous writes and the limiter's own memory use. Counts are still
// browser-based, not proof of distinct people.
func (a *app) allowLike(ip string, now time.Time) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.likeWindows == nil {
		a.likeWindows = make(map[string]likeWindow)
	}
	window, exists := a.likeWindows[ip]
	if !exists || now.Sub(window.Started) >= time.Minute {
		for key, old := range a.likeWindows {
			if now.Sub(old.Started) >= time.Minute {
				delete(a.likeWindows, key)
			}
		}
		if len(a.likeWindows) >= 4096 {
			return false
		}
		window = likeWindow{Started: now}
	}
	if window.Requests >= 60 {
		return false
	}
	window.Requests++
	a.likeWindows[ip] = window
	return true
}

func validLikeTarget(kind, id string) bool {
	if kind == "story" {
		if len(id) == 0 || len(id) > 120 {
			return false
		}
		for _, c := range id {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
				return false
			}
		}
		return true
	}
	if kind != "post" || len(id) > 500 {
		return false
	}
	u, err := url.Parse(id)
	return err == nil && u.Scheme == "" && u.Host == "" && u.RawQuery == "" && u.Fragment == "" && strings.HasPrefix(id, "/posts/") && strings.HasSuffix(id, "/") && !strings.Contains(id, "..")
}

// Live stories are checked directly. Jekyll supplies a manifest for published
// posts and fallback stories; the server never accepts a client-supplied title.
func (a *app) findLikeTarget(kind, id string) (LikeTarget, error) {
	if kind == "story" {
		stories, err := a.load()
		if err != nil {
			return LikeTarget{}, err
		}
		for _, s := range stories {
			if s.ID == id {
				title := s.Title
				if title == "" {
					title = s.Text
				}
				return LikeTarget{Kind: kind, ID: id, Title: title}, nil
			}
		}
	}
	a.targetMu.Lock()
	defer a.targetMu.Unlock()
	if time.Since(a.targetsUpdated) > time.Minute {
		client := &http.Client{Timeout: 3 * time.Second}
		response, err := client.Get(strings.TrimRight(env("BLOG_ORIGIN", "http://blog:8080"), "/") + "/like-targets.json")
		if err != nil {
			return LikeTarget{}, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return LikeTarget{}, fmt.Errorf("content manifest returned %d", response.StatusCode)
		}
		var targets []LikeTarget
		if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&targets); err != nil {
			return LikeTarget{}, err
		}
		a.targets = targets
		a.targetsUpdated = time.Now()
	}
	for _, target := range a.targets {
		if target.Kind == kind && target.ID == id {
			return target, nil
		}
	}
	return LikeTarget{}, os.ErrNotExist
}

func (a *app) likePath(kind, id string) string {
	sum := sha256.Sum256([]byte(kind + ":" + id))
	return filepath.Join(a.dataDir, "likes", hex.EncodeToString(sum[:])+".json")
}

func (a *app) loadLikes(kind, id string) (ContentLikes, error) {
	content := ContentLikes{LikeTarget: LikeTarget{Kind: kind, ID: id}, Visitors: map[string]Visit{}}
	b, err := os.ReadFile(a.likePath(kind, id))
	if os.IsNotExist(err) {
		return content, nil
	}
	if err != nil {
		return content, err
	}
	if err := json.Unmarshal(b, &content); err != nil {
		return content, err
	}
	if content.Visitors == nil {
		content.Visitors = map[string]Visit{}
	}
	return content, nil
}

func (a *app) signLikeID(id string) string {
	mac := hmac.New(sha256.New, []byte(a.password))
	mac.Write([]byte("like-visitor:" + id))
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *app) likeVisitor(r *http.Request) string {
	cookie, err := r.Cookie("fmert_likes")
	if err != nil {
		return ""
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 || len(parts[0]) != 64 || !hmac.Equal([]byte(parts[1]), []byte(a.signLikeID(parts[0]))) {
		return ""
	}
	// Persist only a hash of the cookie's random value.
	sum := sha256.Sum256([]byte(parts[0]))
	return hex.EncodeToString(sum[:])
}

func (a *app) newLikeVisitor(w http.ResponseWriter) (string, error) {
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(random[:])
	http.SetCookie(w, &http.Cookie{Name: "fmert_likes", Value: id + "." + a.signLikeID(id), Path: "/", MaxAge: 365 * 24 * 60 * 60, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:]), nil
}

func writeLikeState(w http.ResponseWriter, content ContentLikes, visitor string) {
	_, liked := content.Visitors[visitor]
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(LikeState{Count: len(content.Visitors), Liked: liked})
}

func (a *app) getLikes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	kind, id := r.URL.Query().Get("kind"), r.URL.Query().Get("id")
	if !validLikeTarget(kind, id) {
		http.Error(w, "Geçersiz içerik", http.StatusBadRequest)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	content, err := a.loadLikes(kind, id)
	if err != nil {
		http.Error(w, "Beğeniler yüklenemedi", http.StatusInternalServerError)
		return
	}
	writeLikeState(w, content, a.likeVisitor(r))
}

func sameOriginLike(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	origin, err := url.Parse(r.Header.Get("Origin"))
	return err == nil && (origin.Scheme == "https" || origin.Scheme == "http") && origin.Host == r.Host && origin.User == nil
}

func (a *app) setLike(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !sameOriginLike(r) {
		http.Error(w, "Geçersiz kaynak", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var input struct {
		Kind     string `json:"kind"`
		ID       string `json:"id"`
		Liked    *bool  `json:"liked"`
		Referrer string `json:"referrer"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil || input.Liked == nil || !validLikeTarget(input.Kind, input.ID) {
		http.Error(w, "Geçersiz beğeni", http.StatusBadRequest)
		return
	}
	visitor := a.likeVisitor(r)
	if !a.allowLike(clientIP(r), time.Now()) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Çok fazla istek. Bir dakika sonra tekrar dene.", http.StatusTooManyRequests)
		return
	}
	var target LikeTarget
	if *input.Liked {
		var err error
		target, err = a.findLikeTarget(input.Kind, input.ID)
		if errors.Is(err, os.ErrNotExist) {
			http.Error(w, "İçerik bulunamadı", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "İçerik şu anda doğrulanamıyor", http.StatusServiceUnavailable)
			return
		}
		if visitor == "" {
			visitor, err = a.newLikeVisitor(w)
			if err != nil {
				http.Error(w, "Beğeni kaydedilemedi", http.StatusInternalServerError)
				return
			}
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	content, err := a.loadLikes(input.Kind, input.ID)
	if err != nil {
		http.Error(w, "Beğeniler yüklenemedi", http.StatusInternalServerError)
		return
	}
	if *input.Liked {
		content.LikeTarget = target
		if _, exists := content.Visitors[visitor]; !exists {
			page := "/"
			if target.Kind == "post" {
				page = target.ID
			}
			content.Visitors[visitor] = visitFromRequest(r, page, input.Referrer)
		}
	} else {
		delete(content.Visitors, visitor)
	}
	if err := os.MkdirAll(filepath.Join(a.dataDir, "likes"), 0700); err != nil {
		http.Error(w, "Beğeni kaydedilemedi", http.StatusInternalServerError)
		return
	}
	if len(content.Visitors) == 0 {
		err = os.Remove(a.likePath(input.Kind, input.ID))
		if os.IsNotExist(err) {
			err = nil
		}
	} else {
		err = writeJSONAtomic(a.likePath(input.Kind, input.ID), content)
	}
	if err != nil {
		http.Error(w, "Beğeni kaydedilemedi", http.StatusInternalServerError)
		return
	}
	writeLikeState(w, content, visitor)
}

func (a *app) likesSummary() (LikesSummary, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	var result LikesSummary
	dir := filepath.Join(a.dataDir, "likes")
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return result, err
		}
		var content ContentLikes
		if err := json.Unmarshal(b, &content); err != nil {
			return result, err
		}
		result.Total += len(content.Visitors)
		result.Content = append(result.Content, LikedContent{LikeTarget: content.LikeTarget, Count: len(content.Visitors)})
		for _, visit := range content.Visitors {
			result.Recent = append(result.Recent, LikeRow{LikeTarget: content.LikeTarget, Visit: visit})
		}
	}
	sort.Slice(result.Content, func(i, j int) bool {
		if result.Content[i].Count == result.Content[j].Count {
			return result.Content[i].Kind+result.Content[i].ID < result.Content[j].Kind+result.Content[j].ID
		}
		return result.Content[i].Count > result.Content[j].Count
	})
	sort.Slice(result.Recent, func(i, j int) bool { return result.Recent[i].Time > result.Recent[j].Time })
	// Every current like is shown; unlike removes both the count and its snapshot.
	for i := range result.Recent {
		at, _ := time.Parse(time.RFC3339, result.Recent[i].Time)
		result.Recent[i].Time = at.In(time.FixedZone("TRT", 3*3600)).Format("02.01.2006 15:04")
	}
	return result, nil
}
