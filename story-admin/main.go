package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type Story struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Image     string `json:"image,omitempty"`
	BG        string `json:"bg,omitempty"`
	Title     string `json:"title,omitempty"`
	Text      string `json:"text"`
	Subtext   string `json:"subtext,omitempty"`
	Link      string `json:"link,omitempty"`
	LinkLabel string `json:"link_label,omitempty"`
	Posted    string `json:"posted"`
}

type ManagedPost struct {
	File     string `json:"file"`
	Title    string `json:"title"`
	Date     string `json:"date"`
	Category string `json:"category"`
	URL      string `json:"url"`
}

type PostMetadata struct {
	Slug     string   `json:"slug"`
	Category string   `json:"category"`
	Tags     []string `json:"tags"`
}

type PostPublishStatus struct {
	State   string `json:"state"`
	File    string `json:"file,omitempty"`
	Message string `json:"message,omitempty"`
	Updated string `json:"updated,omitempty"`
}

type AdminPageData struct {
	ActiveTab string
	Stories   []Story
	Posts     []ManagedPost
	Analytics AnalyticsSummary
	Likes     LikesSummary
}

type app struct {
	dataDir        string
	password       string
	mu             sync.Mutex
	targetMu       sync.Mutex
	targets        []LikeTarget
	targetsUpdated time.Time
	likeWindows    map[string]likeWindow
	loginLimiter   requestLimiter
	visitLimiter   requestLimiter
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		response, err := http.Get("http://127.0.0.1:8081/health")
		if err != nil || response.StatusCode != http.StatusNoContent {
			os.Exit(1)
		}
		response.Body.Close()
		return
	}
	a := &app{dataDir: env("DATA_DIR", "/data"), password: os.Getenv("STORY_PASSWORD")}
	if a.password == "" {
		log.Fatal("STORY_PASSWORD ortam değişkeni zorunludur")
	}
	if err := os.MkdirAll(filepath.Join(a.dataDir, "media"), 0755); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /stories-api", a.list)
	mux.HandleFunc("POST /stories-api", a.create)
	mux.HandleFunc("POST /stories-api/delete", a.delete)
	mux.HandleFunc("GET /stories-admin", a.admin)
	mux.HandleFunc("POST /stories-api/analytics/visit", a.recordVisit)
	mux.HandleFunc("GET /stories-api/likes", a.getLikes)
	mux.HandleFunc("POST /stories-api/likes", a.setLike)
	mux.HandleFunc("POST /stories-login", a.login)
	mux.HandleFunc("POST /stories-logout", a.logout)
	mux.HandleFunc("POST /stories-api/posts", a.createPost)
	mux.HandleFunc("POST /stories-api/posts/metadata", a.postMetadata)
	mux.HandleFunc("GET /stories-api/posts/status", a.postStatus)
	mux.Handle("GET /story-media/", http.StripPrefix("/story-media/", http.FileServer(http.Dir(filepath.Join(a.dataDir, "media")))))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })

	log.Println("hikâye yönetimi :8081 portunu dinliyor")
	log.Fatal(http.ListenAndServe(":8081", mux))
}

func (a *app) list(w http.ResponseWriter, _ *http.Request) {
	stories, err := a.load()
	if err != nil {
		http.Error(w, "Hikâyeler yüklenemedi", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(stories)
}

func (a *app) admin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !a.authorized(r) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		loginPage.Execute(w, r.URL.Query().Has("error"))
		return
	}
	stories, err := a.load()
	if err != nil {
		http.Error(w, "Hikâyeler yüklenemedi", http.StatusInternalServerError)
		return
	}
	posts, err := a.loadManagedPosts()
	if err != nil {
		http.Error(w, "Yazılar yüklenemedi", http.StatusInternalServerError)
		return
	}
	activeTab := "stories"
	if tab := r.URL.Query().Get("tab"); tab == "posts" || tab == "analytics" {
		activeTab = tab
	}
	var analytics AnalyticsSummary
	var likes LikesSummary
	if activeTab == "analytics" {
		analytics, err = a.analyticsSummary()
		if err != nil {
			http.Error(w, "Analitik yüklenemedi", http.StatusInternalServerError)
			return
		}
		likes, err = a.likesSummary()
		if err != nil {
			http.Error(w, "Beğeniler yüklenemedi", http.StatusInternalServerError)
			return
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	adminPage.Execute(w, AdminPageData{ActiveTab: activeTab, Stories: stories, Posts: posts, Analytics: analytics, Likes: likes})
}

func (a *app) create(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		http.Redirect(w, r, "/stories-admin", http.StatusSeeOther)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		http.Error(w, "Yüklenen dosya çok büyük (en fazla 10 MB)", http.StatusBadRequest)
		return
	}

	s := Story{
		Type:      r.FormValue("type"),
		BG:        strings.TrimSpace(r.FormValue("bg")),
		Title:     strings.TrimSpace(r.FormValue("title")),
		Text:      strings.TrimSpace(r.FormValue("text")),
		Subtext:   strings.TrimSpace(r.FormValue("subtext")),
		Link:      strings.TrimSpace(r.FormValue("link")),
		LinkLabel: strings.TrimSpace(r.FormValue("link_label")),
		Posted:    time.Now().UTC().Format(time.RFC3339),
	}
	if err := validate(s); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.ID = newID()

	file, header, err := r.FormFile("image")
	if err == nil {
		defer file.Close()
		ext, err := saveImage(filepath.Join(a.dataDir, "media"), s.ID, file, header.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.Image = "/story-media/" + s.ID + ext
	} else if !errors.Is(err, http.ErrMissingFile) {
		http.Error(w, "Görsel okunamadı", http.StatusBadRequest)
		return
	}
	if s.Type == "image" && s.Image == "" {
		http.Error(w, "Fotoğraf türündeki hikâyeler için görsel gereklidir", http.StatusBadRequest)
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	stories, err := a.loadUnlocked()
	if err == nil {
		stories = append([]Story{s}, stories...)
		err = a.saveUnlocked(stories)
	}
	if err != nil {
		http.Error(w, "Hikâye kaydedilemedi", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/stories-admin", http.StatusSeeOther)
}

func (a *app) delete(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		http.Redirect(w, r, "/stories-admin", http.StatusSeeOther)
		return
	}
	id := r.FormValue("id")
	a.mu.Lock()
	defer a.mu.Unlock()
	stories, err := a.loadUnlocked()
	if err != nil {
		http.Error(w, "Hikâyeler yüklenemedi", http.StatusInternalServerError)
		return
	}
	kept := stories[:0]
	for _, s := range stories {
		if s.ID == id {
			if strings.HasPrefix(s.Image, "/story-media/") {
				os.Remove(filepath.Join(a.dataDir, "media", filepath.Base(s.Image)))
			}
			continue
		}
		kept = append(kept, s)
	}
	if err := a.saveUnlocked(kept); err != nil {
		http.Error(w, "Hikâye silinemedi", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/stories-admin", http.StatusSeeOther)
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if retry := a.loginLimiter.allow(clientIP(r), time.Now(), 5, 100, 15*time.Minute); retry > 0 {
		tooManyRequests(w, retry)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil || subtle.ConstantTimeCompare([]byte(r.FormValue("password")), []byte(a.password)) != 1 {
		http.Redirect(w, r, "/stories-admin?error=1", http.StatusSeeOther)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "story_session", Value: a.sessionToken(), Path: "/", MaxAge: 7 * 24 * 60 * 60, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	http.Redirect(w, r, "/stories-admin", http.StatusSeeOther)
}

func (a *app) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "story_session", Path: "/", MaxAge: -1, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	http.Redirect(w, r, "/stories-admin", http.StatusSeeOther)
}

func (a *app) sessionToken() string {
	expires := strconv.FormatInt(time.Now().Add(7*24*time.Hour).Unix(), 10)
	mac := hmac.New(sha256.New, []byte(a.password))
	mac.Write([]byte(expires))
	return expires + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (a *app) authorized(r *http.Request) bool {
	cookie, err := r.Cookie("story_session")
	if err != nil {
		return false
	}
	parts := strings.SplitN(cookie.Value, ".", 2)
	if len(parts) != 2 {
		return false
	}
	expires, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || expires < time.Now().Unix() {
		return false
	}
	mac := hmac.New(sha256.New, []byte(a.password))
	mac.Write([]byte(parts[0]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	return err == nil && hmac.Equal(signature, mac.Sum(nil))
}

func (a *app) load() ([]Story, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.loadUnlocked()
}

func (a *app) loadUnlocked() ([]Story, error) {
	b, err := os.ReadFile(filepath.Join(a.dataDir, "stories.json"))
	if errors.Is(err, os.ErrNotExist) {
		return []Story{}, nil
	}
	if err != nil {
		return nil, err
	}
	var stories []Story
	return stories, json.Unmarshal(b, &stories)
}

func (a *app) saveUnlocked(stories []Story) error {
	b, err := json.MarshalIndent(stories, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(a.dataDir, "stories.json.tmp")
	if err := os.WriteFile(tmp, append(b, '\n'), 0644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(a.dataDir, "stories.json"))
}

func (a *app) postsDir() string {
	return filepath.Join(a.dataDir, "posts")
}

func (a *app) createPost(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		http.Error(w, "Oturum süresi doldu", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Yazı verileri okunamadı", http.StatusBadRequest)
		return
	}
	title := strings.TrimSpace(r.FormValue("title"))
	body := strings.TrimSpace(r.FormValue("body"))
	if title == "" || len([]rune(title)) > 160 {
		http.Error(w, "Başlık zorunludur ve en fazla 160 karakter olabilir", http.StatusBadRequest)
		return
	}
	if body == "" || len([]rune(body)) > 200000 {
		http.Error(w, "Markdown içeriği zorunludur ve en fazla 200.000 karakter olabilir", http.StatusBadRequest)
		return
	}

	metadata := inferPostMetadata(title, body)
	now := time.Now().In(time.FixedZone("Europe/Istanbul", 3*60*60))
	datePrefix := now.Format("2006-01-02")
	postsDir := a.postsDir()
	if err := os.MkdirAll(postsDir, 0755); err != nil {
		http.Error(w, "Yazı dizini oluşturulamadı", http.StatusInternalServerError)
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	filename := failedPostFilename(postsDir, title, body)
	if filename == "" {
		var err error
		filename, err = uniquePostFilename(postsDir, datePrefix, metadata.Slug)
		if err != nil {
			http.Error(w, "Yazı dosyası hazırlanamadı", http.StatusInternalServerError)
			return
		}
	}
	titleJSON, _ := json.Marshal(title)
	content := fmt.Sprintf("---\ntitle: %s\ndate: %s\ncategories: %s\ntags: %s\nrender_with_liquid: false\n---\n\n%s\n",
		titleJSON,
		now.Format("2006-01-02 15:04:05 -0700"),
		yamlStringList([]string{metadata.Category}),
		yamlStringList(metadata.Tags),
		body,
	)
	tmp := filepath.Join(postsDir, "."+filename+".tmp")
	if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
		http.Error(w, "Yazı kaydedilemedi", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmp, filepath.Join(postsDir, filename)); err != nil {
		http.Error(w, "Yazı yayın kuyruğuna alınamadı", http.StatusInternalServerError)
		return
	}
	status := PostPublishStatus{State: "queued", File: filename, Message: "Yazı yayın kuyruğunda", Updated: time.Now().UTC().Format(time.RFC3339)}
	if err := writeJSONAtomic(filepath.Join(postsDir, ".publish-status"), status); err != nil {
		http.Error(w, "Yayın durumu kaydedilemedi", http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(filepath.Join(postsDir, ".publish-trigger"), []byte(filename+"\n"), 0644); err != nil {
		http.Error(w, "Yayın işlemi başlatılamadı", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(struct {
		OK       bool         `json:"ok"`
		File     string       `json:"file"`
		URL      string       `json:"url"`
		Metadata PostMetadata `json:"metadata"`
	}{true, filename, postURL(filename), metadata})
}

func (a *app) postMetadata(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		http.Error(w, "Oturum süresi doldu", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "İçerik okunamadı", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(inferPostMetadata(r.FormValue("title"), r.FormValue("body")))
}

func (a *app) postStatus(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(r) {
		http.Error(w, "Oturum süresi doldu", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	b, err := os.ReadFile(filepath.Join(a.postsDir(), ".publish-status"))
	if errors.Is(err, os.ErrNotExist) {
		json.NewEncoder(w).Encode(PostPublishStatus{State: "idle"})
		return
	}
	if err != nil {
		http.Error(w, "Yayın durumu okunamadı", http.StatusInternalServerError)
		return
	}
	w.Write(b)
}

func (a *app) loadManagedPosts() ([]ManagedPost, error) {
	entries, err := os.ReadDir(a.postsDir())
	if errors.Is(err, os.ErrNotExist) {
		return []ManagedPost{}, nil
	}
	if err != nil {
		return nil, err
	}
	posts := make([]ManagedPost, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(a.postsDir(), entry.Name()))
		if err != nil {
			return nil, err
		}
		post := ManagedPost{File: entry.Name(), URL: postURL(entry.Name())}
		for _, line := range strings.Split(string(b), "\n") {
			switch {
			case strings.HasPrefix(line, "title: "):
				_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "title: ")), &post.Title)
			case strings.HasPrefix(line, "date: "):
				post.Date = strings.TrimPrefix(line, "date: ")
			case strings.HasPrefix(line, "categories: ["):
				post.Category = strings.TrimSuffix(strings.TrimPrefix(line, "categories: ["), "]")
			}
			if line == "---" && post.Title != "" {
				break
			}
		}
		posts = append(posts, post)
	}
	sort.Slice(posts, func(i, j int) bool { return posts[i].File > posts[j].File })
	return posts, nil
}

func inferPostMetadata(title, body string) PostMetadata {
	titleText := normalizedText(title)
	allText := titleText + " " + normalizedText(body)
	if strings.TrimSpace(allText) == "" {
		return PostMetadata{Slug: "yazi", Category: "Genel", Tags: []string{}}
	}
	type categoryRule struct {
		name  string
		words []string
	}
	rules := []categoryRule{
		{"Proje", []string{"proje", "uygulama", "gelistirdim", "surum", "yayinladim", "queyntisen", "aria"}},
		{"Araştırma", []string{"arastirma", "analiz", "istatistik", "veri", "gozlem", "saha", "oran", "bulgu"}},
		{"Yazılım", []string{"yazilim", "kod", "python", "linux", "terminal", "api", "android", "kotlin", "github", "llm", "yapay zeka"}},
	}
	category, bestScore := "Genel", 0
	for _, rule := range rules {
		score := 0
		for _, word := range rule.words {
			if strings.Contains(allText, word) {
				score++
			}
			if strings.Contains(titleText, word) {
				score += 2
			}
		}
		if score > bestScore {
			category, bestScore = rule.name, score
		}
	}
	// Başlıktaki açık içerik türü, gövdedeki teknik terimlerden daha güçlü bir işarettir.
	for _, priority := range []categoryRule{rules[1], rules[0]} {
		matched := false
		for _, word := range priority.words {
			if strings.Contains(titleText, word) {
				category, matched = priority.name, true
				break
			}
		}
		if matched {
			break
		}
	}

	tagRules := []struct {
		tag      string
		keywords []string
	}{
		{"yapay-zeka", []string{"yapay zeka", "llm", "openai", "ollama"}},
		{"acik-kaynak", []string{"acik kaynak", "open source", "github"}},
		{"python", []string{"python"}}, {"linux", []string{"linux"}}, {"android", []string{"android", "kotlin"}},
		{"terminal", []string{"terminal", "komut satiri"}}, {"markdown", []string{"markdown", "obsidian"}},
		{"arastirma", []string{"arastirma", "analiz", "veri"}}, {"egitim", []string{"egitim", "ogrenci", "sinav"}},
		{"queyntisen", []string{"queyntisen"}}, {"aria", []string{"aria"}},
	}
	tags := make([]string, 0, 7)
	seen := map[string]bool{}
	for _, rule := range tagRules {
		for _, keyword := range rule.keywords {
			if strings.Contains(allText, keyword) {
				tags = append(tags, rule.tag)
				seen[rule.tag] = true
				break
			}
		}
	}
	stopWords := map[string]bool{"icin": true, "olan": true, "olarak": true, "bunu": true, "bir": true, "ile": true, "ve": true, "ama": true, "daha": true, "yeni": true, "bugun": true, "hakkinda": true, "artik": true}
	for _, word := range strings.Fields(titleText) {
		tag := slugify(word)
		if len(tag) < 4 || stopWords[tag] || seen[tag] {
			continue
		}
		tags = append(tags, tag)
		seen[tag] = true
		if len(tags) >= 7 {
			break
		}
	}
	if len(tags) == 0 {
		tags = []string{slugify(category)}
	}
	return PostMetadata{Slug: slugify(title), Category: category, Tags: tags}
}

func normalizedText(value string) string {
	return strings.ReplaceAll(slugify(value), "-", " ")
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer("ç", "c", "ğ", "g", "ı", "i", "ö", "o", "ş", "s", "ü", "u", "â", "a", "î", "i", "û", "u")
	value = replacer.Replace(value)
	var b strings.Builder
	dash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || unicode.IsDigit(r) {
			b.WriteRune(r)
			dash = false
		} else if b.Len() > 0 && !dash {
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= 80 {
			break
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return "yazi"
	}
	return slug
}

func uniquePostFilename(dir, datePrefix, slug string) (string, error) {
	base := datePrefix + "-" + slug
	filename := base + ".md"
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, filename)); errors.Is(err, os.ErrNotExist) {
			return filename, nil
		} else if err != nil {
			return "", err
		}
		filename = fmt.Sprintf("%s-%d.md", base, i)
	}
}

func failedPostFilename(dir, title, body string) string {
	b, err := os.ReadFile(filepath.Join(dir, ".publish-status"))
	if err != nil {
		return ""
	}
	var status PostPublishStatus
	if json.Unmarshal(b, &status) != nil || status.State != "failed" || filepath.Base(status.File) != status.File || !strings.HasSuffix(status.File, ".md") {
		return ""
	}
	b, err = os.ReadFile(filepath.Join(dir, status.File))
	if err != nil {
		return ""
	}
	existingTitle, existingBody, ok := postTitleAndBody(string(b))
	if !ok || existingTitle != title || existingBody != strings.TrimSpace(body) {
		return ""
	}
	return status.File
}

func postTitleAndBody(content string) (string, string, bool) {
	if !strings.HasPrefix(content, "---\n") {
		return "", "", false
	}
	rest := strings.TrimPrefix(content, "---\n")
	end := strings.Index(rest, "\n---\n")
	if end < 0 {
		return "", "", false
	}
	var title string
	for _, line := range strings.Split(rest[:end], "\n") {
		if strings.HasPrefix(line, "title: ") {
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "title: ")), &title) != nil {
				return "", "", false
			}
			break
		}
	}
	if title == "" {
		return "", "", false
	}
	return title, strings.TrimSpace(rest[end+len("\n---\n"):]), true
}

func yamlStringList(values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		b, _ := json.Marshal(value)
		quoted = append(quoted, string(b))
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func postURL(filename string) string {
	slug := strings.TrimSuffix(filename, ".md")
	if len(slug) > 11 {
		slug = slug[11:]
	}
	return "/posts/" + slug + "/"
}

func writeJSONAtomic(path string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func validate(s Story) error {
	if s.Type != "text" && s.Type != "image" && s.Type != "link" {
		return errors.New("geçersiz hikâye türü")
	}
	if s.Text == "" || len(s.Text) > 1000 || len(s.Title) > 120 || len(s.Subtext) > 1000 || len(s.BG) > 500 || len(s.LinkLabel) > 80 {
		return errors.New("zorunlu metin eksik veya alanlardan biri çok uzun")
	}
	if s.Link != "" {
		u, err := url.Parse(s.Link)
		if err != nil || strings.HasPrefix(s.Link, "//") || (!strings.HasPrefix(s.Link, "/") && u.Scheme != "http" && u.Scheme != "https") {
			return errors.New("bağlantı /, http:// veya https:// ile başlamalıdır")
		}
	}
	return nil
}

func saveImage(dir, id string, src io.Reader, size int64) (string, error) {
	if size > 10<<20 {
		return "", errors.New("görsel çok büyük (en fazla 10 MB)")
	}
	b, err := io.ReadAll(io.LimitReader(src, 10<<20+1))
	if err != nil || len(b) > 10<<20 {
		return "", errors.New("görsel çok büyük (en fazla 10 MB)")
	}
	extensions := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
	ext, ok := extensions[http.DetectContentType(b)]
	if !ok {
		return "", errors.New("görsel JPEG, PNG, WebP veya GIF biçiminde olmalıdır")
	}
	return ext, os.WriteFile(filepath.Join(dir, id+ext), b, 0644)
}

func newID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return time.Now().UTC().Format("20060102-150405-") + hex.EncodeToString(b)
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

var loginPage = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>İçerik stüdyosu · Giriş</title>
  <style>
    :root{--bg:#0b0b11;--surface:#15151f;--surface-2:#1d1d29;--line:#2b2b3a;--text:#f5f3ff;--muted:#9896a8;--accent:#8067f2;--accent-2:#a68cff;--danger:#ff788b}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,rgba(128,103,242,.14),transparent 38%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .login{width:min(100%,420px)}.brand{display:flex;align-items:center;gap:11px;margin-bottom:22px;color:#c5bddf;font-size:13px;font-weight:700;letter-spacing:.04em}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:linear-gradient(145deg,var(--accent-2),#6448e7);box-shadow:0 10px 30px rgba(100,72,231,.28);font-size:17px}.card{padding:30px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(155deg,rgba(29,29,41,.95),rgba(18,18,27,.98));box-shadow:0 30px 80px rgba(0,0,0,.38)}
    .eyebrow{margin:0 0 7px;color:var(--accent-2);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-size:28px;letter-spacing:-.035em}p{margin:8px 0 24px;color:var(--muted)}label{display:grid;gap:8px;color:#c8c6d1;font-size:13px;font-weight:700}.password{position:relative}.password input{padding-right:70px}input,button{width:100%;border-radius:12px;font:inherit}input{height:50px;padding:0 14px;border:1px solid var(--line);outline:0;background:#101018;color:var(--text);transition:border-color .2s,box-shadow .2s}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(128,103,242,.14)}.show{position:absolute;right:6px;bottom:6px;width:auto;height:38px;padding:0 10px;border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:12px;font-weight:700}.submit{height:50px;margin-top:16px;border:0;background:linear-gradient(135deg,var(--accent),#654ae3);color:#fff;font-weight:800;cursor:pointer;box-shadow:0 12px 30px rgba(101,74,227,.25)}.submit:hover{filter:brightness(1.08)}.error{margin:0 0 18px;padding:11px 13px;border:1px solid rgba(255,120,139,.28);border-radius:11px;background:rgba(255,120,139,.08);color:#ffadba;font-size:13px}
    @media(max-width:520px){.card{padding:24px;border-radius:20px}h1{font-size:25px}}
  </style>
</head>
<body>
  <main class="login">
    <div class="brand"><span class="brand-mark">✦</span> fmert.me</div>
    <section class="card">
      <p class="eyebrow">Yönetim paneli</p>
      <h1>İçerik stüdyosu</h1>
      <p>Hikâyelerini ve blog yazılarını oluşturmak için giriş yap.</p>
      {{if .}}<div class="error" role="alert">Şifre yanlış. Tekrar deneyebilirsin.</div>{{end}}
      <form method="post" action="/stories-login">
        <label>Şifre
          <span class="password">
            <input id="password" name="password" type="password" required autofocus autocomplete="current-password">
            <button class="show" type="button" aria-controls="password">Göster</button>
          </span>
        </label>
        <button class="submit">Giriş yap</button>
      </form>
    </section>
  </main>
  <script>
    var show=document.querySelector('.show'),password=document.getElementById('password');
    show.addEventListener('click',function(){var visible=password.type==='text';password.type=visible?'password':'text';show.textContent=visible?'Göster':'Gizle';password.focus()});
  </script>
</body>
</html>`))

var adminPage = template.Must(template.New("admin").Parse(`<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>İçerik stüdyosu</title>
  <style>
    :root{--bg:#0b0b11;--surface:#14141d;--surface-2:#1a1a25;--surface-3:#20202d;--line:#2b2b3a;--line-soft:#232330;--text:#f5f3ff;--muted:#9795a6;--muted-2:#747283;--accent:#8067f2;--accent-2:#a78fff;--success:#55d6a7;--danger:#ff7187;--shadow:0 22px 70px rgba(0,0,0,.28)}
    *{box-sizing:border-box}[hidden]{display:none!important}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 48% -15%,rgba(128,103,242,.12),transparent 34%),var(--bg);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea{font:inherit}button,a{-webkit-tap-highlight-color:transparent}.topbar{position:sticky;top:0;z-index:20;border-bottom:1px solid rgba(43,43,58,.82);background:rgba(11,11,17,.86);backdrop-filter:blur(18px)}.topbar-inner{max-width:1180px;min-height:68px;margin:auto;padding:0 22px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px}.brand{display:flex;align-items:center;gap:11px;font-weight:800;letter-spacing:-.015em}.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;background:linear-gradient(145deg,var(--accent-2),#6448e7);box-shadow:0 9px 25px rgba(100,72,231,.25)}.brand small{display:block;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.02em}.app-tabs{display:flex;gap:4px;padding:4px;border:1px solid var(--line-soft);border-radius:12px;background:#101018}.app-tab{min-width:100px;height:36px;display:flex;align-items:center;justify-content:center;gap:7px;padding:0 14px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:12px;font-weight:800}.app-tab:hover{color:#fff}.app-tab.active{background:var(--surface-3);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.22)}.top-actions{justify-self:end;display:flex;align-items:center;gap:8px}.ghost,.logout{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;padding:0 13px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:#cbc8d8;text-decoration:none;font-weight:700;cursor:pointer}.logout{width:38px;padding:0;color:var(--muted)}.logout-form{margin:0}.ghost:hover,.logout:hover{border-color:#45435a;color:#fff}
    main{max-width:1180px;margin:auto;padding:32px 22px 60px}.intro{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.eyebrow{margin:0 0 5px;color:var(--accent-2);font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}h1,h2,p{margin-top:0}h1{margin-bottom:5px;font-size:30px;letter-spacing:-.04em}.intro-copy{margin:0;color:var(--muted)}.status{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12px;font-weight:700}.status-dot{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 0 4px rgba(85,214,167,.1)}
    .workspace{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;align-items:start}.panel{border:1px solid var(--line-soft);border-radius:20px;background:linear-gradient(155deg,rgba(22,22,32,.98),rgba(17,17,25,.98));box-shadow:var(--shadow)}.composer{padding:22px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}.section-head h2{margin:0;font-size:17px;letter-spacing:-.02em}.section-head span{color:var(--muted-2);font-size:12px}
    .type-switch{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:5px;margin:0 0 22px;border:1px solid var(--line-soft);border-radius:13px;background:#101018}.type-option{position:relative}.type-option input{position:absolute;opacity:0;pointer-events:none}.type-option span{height:42px;display:flex;align-items:center;justify-content:center;gap:7px;border-radius:9px;color:var(--muted);font-size:13px;font-weight:800;cursor:pointer;transition:.2s}.type-option input:checked+span{background:var(--surface-3);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.22)}.type-option input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}.type-icon{font-size:15px}
    .fields{display:grid;gap:17px}.field{display:grid;gap:7px}.field[hidden]{display:none}.label-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.label{color:#d1cfda;font-size:12px;font-weight:800}.optional{color:var(--muted-2);font-size:11px;font-weight:600}.counter{color:var(--muted-2);font-size:11px;font-variant-numeric:tabular-nums}.control{width:100%;border:1px solid var(--line);border-radius:11px;outline:0;background:#101018;color:var(--text);transition:border-color .2s,box-shadow .2s}.control:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(128,103,242,.13)}input.control{height:45px;padding:0 13px}textarea.control{min-height:112px;padding:12px 13px;resize:vertical}.help{margin:0;color:var(--muted-2);font-size:11px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:13px}.upload{min-height:120px;display:grid;place-items:center;padding:18px;border:1px dashed #3c3a50;border-radius:13px;background:#101018;text-align:center;cursor:pointer;transition:.2s}.upload:hover,.upload.drag{border-color:var(--accent);background:rgba(128,103,242,.06)}.upload input{position:absolute;width:1px;height:1px;opacity:0}.upload-icon{display:grid;place-items:center;width:36px;height:36px;margin:0 auto 8px;border-radius:11px;background:var(--surface-3);color:var(--accent-2);font-size:18px}.upload strong{display:block;font-size:13px}.upload small{display:block;margin-top:3px;color:var(--muted-2);font-size:11px}.presets{display:flex;gap:9px;flex-wrap:wrap}.preset{width:34px;height:34px;padding:0;border:2px solid transparent;border-radius:10px;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}.preset.active{border-color:#fff;box-shadow:0 0 0 2px var(--accent)}details{border-top:1px solid var(--line-soft);padding-top:14px}summary{color:#b9b6c6;font-size:12px;font-weight:800;cursor:pointer;user-select:none}details .field{margin-top:13px}.form-error{display:none;padding:11px 13px;border:1px solid rgba(255,113,135,.25);border-radius:11px;background:rgba(255,113,135,.08);color:#ffacb9;font-size:12px}.form-error.show{display:block}.publish-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-top:4px}.publish-note{margin:0;color:var(--muted-2);font-size:11px}.publish{min-width:150px;height:46px;padding:0 18px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--accent),#6347df);color:#fff;font-weight:850;cursor:pointer;box-shadow:0 12px 28px rgba(99,71,223,.25)}.publish:hover{filter:brightness(1.08)}.publish:disabled{opacity:.58;cursor:wait}
    .preview-panel{position:sticky;top:92px;padding:18px}.preview-label{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.preview-label span:last-child{font-weight:600;letter-spacing:0;text-transform:none}.story-preview{position:relative;isolation:isolate;aspect-ratio:9/14.5;overflow:hidden;border-radius:20px;background:linear-gradient(160deg,#171824,#2a2050);box-shadow:0 18px 42px rgba(0,0,0,.35)}.story-preview:after{content:"";position:absolute;z-index:-1;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.42),transparent 30%,rgba(0,0,0,.55))}.preview-image{position:absolute;z-index:-2;inset:0;width:100%;height:100%;object-fit:cover}.preview-image[hidden]{display:none}.progress{position:absolute;top:12px;left:12px;right:12px;height:3px;border-radius:9px;background:rgba(255,255,255,.28);overflow:hidden}.progress:after{content:"";display:block;width:62%;height:100%;background:#fff}.story-head{position:absolute;top:26px;left:14px;right:14px;display:flex;align-items:center;gap:9px}.avatar{width:30px;height:30px;border:2px solid rgba(255,255,255,.85);border-radius:50%;background:url('/assets/img/avatar.jpg') center/cover,#2b2b38}.user{font-size:12px;font-weight:800;text-shadow:0 1px 8px #000}.user small{display:block;color:rgba(255,255,255,.7);font-size:9px;font-weight:600}.badge{margin-left:auto;padding:4px 7px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(10,10,15,.28);font-size:8px;font-weight:900;letter-spacing:.1em}.preview-content{position:absolute;left:22px;right:22px;bottom:62px;text-align:center;text-shadow:0 2px 14px rgba(0,0,0,.45)}.preview-content strong{display:block;font-size:25px;line-height:1.12;letter-spacing:-.04em;overflow-wrap:anywhere}.preview-content p{margin:9px 0 0;color:rgba(255,255,255,.77);font-size:11px;line-height:1.45;overflow-wrap:anywhere}.preview-cta{position:absolute;left:22px;right:22px;bottom:18px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(255,255,255,.94);color:#17151f;font-size:11px;font-weight:900}.preview-cta[hidden]{display:none}.preview-tip{margin:12px 3px 0;color:var(--muted-2);font-size:11px;text-align:center}
    .post-workspace{grid-template-columns:minmax(0,1fr) 430px}.markdown-tools{display:flex;flex-wrap:wrap;gap:5px;padding:6px;border:1px solid var(--line);border-bottom:0;border-radius:11px 11px 0 0;background:#101018}.markdown-tool{min-width:34px;height:32px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:#aaa7b8;font-size:12px;font-weight:850;cursor:pointer}.markdown-tool:hover{background:var(--surface-3);color:#fff}.markdown-editor{min-height:450px!important;border-radius:0 0 11px 11px!important;line-height:1.65!important;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace!important;tab-size:2}.metadata-box{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:11px;border:1px solid var(--line-soft);border-radius:12px;background:#101018}.metadata-item{min-width:0}.metadata-item small,.metadata-item strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metadata-item small{margin-bottom:3px;color:var(--muted-2);font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.metadata-item strong{color:#cfccda;font-size:11px}.publish-state{display:none;padding:12px 13px;border:1px solid rgba(128,103,242,.25);border-radius:11px;background:rgba(128,103,242,.08);color:#c8bcff;font-size:12px}.publish-state.show{display:block}.publish-state.success{border-color:rgba(85,214,167,.25);background:rgba(85,214,167,.08);color:#83e5c3}.publish-state.error{border-color:rgba(255,113,135,.25);background:rgba(255,113,135,.08);color:#ffacb9}.publish-state a{color:inherit;font-weight:850}.article-preview{min-height:600px;padding:28px 26px;overflow-wrap:anywhere;border-radius:16px;background:#101018}.article-preview-meta{display:flex;align-items:center;gap:8px;margin-bottom:14px;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.article-preview-category{padding:4px 7px;border-radius:6px;background:rgba(128,103,242,.13);color:var(--accent-2)}.article-preview h1{margin:0 0 22px;font-size:31px;line-height:1.12;letter-spacing:-.045em}.article-preview-body{color:#c6c3cf;font-size:13px;line-height:1.75}.article-preview-body h2,.article-preview-body h3{margin:26px 0 9px;color:#f2eff9;line-height:1.25;letter-spacing:-.025em}.article-preview-body h2{font-size:20px}.article-preview-body h3{font-size:16px}.article-preview-body p{margin:0 0 14px}.article-preview-body blockquote{margin:16px 0;padding:3px 0 3px 14px;border-left:3px solid var(--accent);color:#aaa7b7}.article-preview-body code{padding:2px 5px;border-radius:5px;background:#20202b;color:#d7cffc;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.article-preview-body pre{padding:13px;overflow:auto;border:1px solid var(--line);border-radius:9px;background:#09090e}.article-preview-body pre code{padding:0;background:transparent}.article-preview-body a{color:var(--accent-2)}.article-preview-body ul{padding-left:20px}.article-placeholder{color:var(--muted-2)}.post-card{display:flex;align-items:center;gap:13px;padding:13px;border:1px solid var(--line-soft);border-radius:13px;background:#111119;color:inherit;text-decoration:none}.post-card:hover{border-color:#403d54;background:#15151e}.post-icon{flex:0 0 38px;height:38px;display:grid;place-items:center;border-radius:10px;background:rgba(128,103,242,.1);color:var(--accent-2);font-size:17px}.post-card .story-info{flex:1}.post-open{color:var(--muted-2)}
    .library{margin-top:28px;padding:22px}.library-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.story-card{min-width:0;display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:12px;padding:10px;border:1px solid var(--line-soft);border-radius:14px;background:#111119}.story-thumb{width:58px;aspect-ratio:4/5;border-radius:10px;background:linear-gradient(150deg,#262337,#392b68);background-position:center;background-size:cover}.story-info{min-width:0}.story-info strong,.story-info span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.story-info strong{font-size:12px}.story-info span{margin-top:3px;color:var(--muted);font-size:11px}.story-meta{display:flex;align-items:center;gap:7px;margin-top:5px;color:var(--muted-2);font-size:10px}.story-state{padding:2px 6px;border-radius:99px;background:rgba(85,214,167,.1);color:#75dfba;font-weight:800}.story-state.expired{background:rgba(151,149,166,.1);color:var(--muted)}.delete-form{margin:0}.delete{width:34px;height:34px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--muted-2);cursor:pointer;font-size:17px}.delete:hover{border-color:rgba(255,113,135,.2);background:rgba(255,113,135,.08);color:var(--danger)}.empty{grid-column:1/-1;padding:34px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);text-align:center}.empty strong{display:block;margin-bottom:4px;color:#ccc9d8}.toast{position:fixed;right:20px;bottom:20px;z-index:30;max-width:340px;padding:12px 15px;border:1px solid var(--line);border-radius:12px;background:#20202b;color:#fff;box-shadow:var(--shadow);transform:translateY(20px);opacity:0;pointer-events:none;transition:.25s}.toast.show{transform:none;opacity:1}
    .analytics-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric{padding:20px}.metric strong{display:block;font-size:30px}.metric span{color:var(--muted);font-size:12px}.analytics-table{width:100%;border-collapse:collapse;font-size:12px}.analytics-table th,.analytics-table td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;overflow-wrap:anywhere}.analytics-table th{color:var(--muted)}.table-wrap{overflow-x:auto}.analytics-note{color:var(--muted);font-size:12px}
    @media(max-width:900px){.workspace{grid-template-columns:1fr}.preview-panel{position:relative;top:auto;max-width:640px;width:100%;margin:auto;grid-row:2}.library-grid{grid-template-columns:1fr 1fr}.topbar-inner{grid-template-columns:auto 1fr auto}.brand small{display:none}.app-tabs{justify-self:center}.article-preview{min-height:420px}}
    @media(max-width:640px){.topbar-inner{min-height:110px;padding:10px 15px;grid-template-columns:1fr auto;grid-template-rows:auto auto}.brand small,.ghost span{display:none}.app-tabs{grid-column:1/-1;grid-row:2;width:100%}.app-tab{flex:1;min-width:0;padding:0 5px}.top-actions{grid-column:2;grid-row:1}main{padding:24px 14px 45px}.intro{align-items:start}.intro .status{display:none}h1{font-size:26px}.composer,.library{padding:17px}.workspace{gap:16px}.two-col,.library-grid,.metadata-box,.analytics-grid{grid-template-columns:1fr}.publish-row{align-items:stretch;flex-direction:column}.publish{width:100%}.story-card{grid-template-columns:52px minmax(0,1fr) auto}.story-thumb{width:52px}.markdown-editor{min-height:360px!important}.article-preview{min-height:360px;padding:21px 18px}.article-preview h1{font-size:26px}}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand"><span class="brand-mark">✦</span><span>İçerik stüdyosu<small>fmert.me</small></span></div>
      <nav class="app-tabs" aria-label="İçerik türü">
        <a class="app-tab {{if eq .ActiveTab "stories"}}active{{end}}" href="/stories-admin">◉ Hikâyeler</a>
        <a class="app-tab {{if eq .ActiveTab "posts"}}active{{end}}" href="/stories-admin?tab=posts">▤ Yazılar</a>
        <a class="app-tab {{if eq .ActiveTab "analytics"}}active{{end}}" href="/stories-admin?tab=analytics">◫ Analitik</a>
      </nav>
      <div class="top-actions">
        <a class="ghost" href="/" target="_blank" rel="noopener"><span>Siteyi aç</span> ↗</a>
        <form class="logout-form" method="post" action="/stories-logout"><button class="logout" title="Çıkış yap" aria-label="Çıkış yap">↪</button></form>
      </div>
    </div>
  </header>

  <main>
    {{if eq .ActiveTab "analytics"}}
    <section class="intro"><div><p class="eyebrow">Site trafiği</p><h1>Analitik</h1><p class="intro-copy">Son 30 gün · saatler Türkiye saatiyle</p></div></section>
    <section class="panel library" style="margin:0 0 24px">
      <div class="section-head"><h2>Beğeniler</h2><span>{{.Likes.Total}} toplam beğeni · tüm zamanlar</span></div>
      <div class="table-wrap"><table class="analytics-table"><thead><tr><th>İçerik</th><th>Tür</th><th>Beğeni</th></tr></thead><tbody>
      {{range .Likes.Content}}<tr><td>{{if eq .Kind "post"}}<a href="{{.ID}}">{{.Title}}</a>{{else}}{{.Title}}{{end}}</td><td>{{if eq .Kind "post"}}Yazı{{else}}Hikâye{{end}}</td><td>{{.Count}}</td></tr>
      {{else}}<tr><td colspan="3">Henüz beğeni yok.</td></tr>{{end}}
      </tbody></table></div>
      <details style="margin-top:20px"><summary>Beğenen ziyaretçilerin bilgileri ({{.Likes.Total}})</summary>
        <p class="analytics-note">Her satır, beğeni anındaki bilgileri gösterir. Aynı IP farklı kişilere ait olabilir. Beğeni geri alındığında bu kayıt silinir.</p>
        <div class="table-wrap"><table class="analytics-table"><thead><tr><th>Zaman</th><th>İçerik</th><th>Tür</th><th>IP</th><th>Sayfa</th><th>Cihaz</th><th>Tarayıcı</th><th>Kaynak</th></tr></thead><tbody>
        {{range .Likes.Recent}}<tr><td>{{.Time}}</td><td>{{.Title}}</td><td>{{if eq .Kind "post"}}Yazı{{else}}Hikâye{{end}}</td><td>{{.IP}}</td><td>{{.Path}}</td><td>{{.Device}}</td><td>{{.Browser}}</td><td>{{.Referrer}}</td></tr>
        {{else}}<tr><td colspan="8">Henüz beğeni yok.</td></tr>{{end}}
        </tbody></table></div>
      </details>
    </section>
    <div class="analytics-grid">
      <div class="panel metric"><strong>{{.Analytics.Views}}</strong><span>Sayfa görüntüleme</span></div>
      <div class="panel metric"><strong>{{.Analytics.UniqueIPs}}</strong><span>Farklı IP (kişi sayısı değildir)</span></div>
      <div class="panel metric"><strong>{{.Analytics.Today}}</strong><span>Bugünkü görüntüleme</span></div>
    </div>
    <section class="panel library"><div class="section-head"><h2>En çok görüntülenen sayfalar</h2></div><div class="table-wrap"><table class="analytics-table"><thead><tr><th>Sayfa</th><th>Görüntüleme</th></tr></thead><tbody>{{range .Analytics.Pages}}<tr><td>{{.Name}}</td><td>{{.Count}}</td></tr>{{else}}<tr><td colspan="2">Henüz veri yok</td></tr>{{end}}</tbody></table></div></section>
    <section class="panel library"><div class="section-head"><h2>Cihazlar ve kaynaklar</h2></div><div class="analytics-grid"><div><h3>Cihaz</h3>{{range .Analytics.Devices}}<p>{{.Name}} · {{.Count}}</p>{{end}}</div><div><h3>Tarayıcı</h3>{{range .Analytics.Browsers}}<p>{{.Name}} · {{.Count}}</p>{{end}}</div><div><h3>Yönlendiren site</h3>{{range .Analytics.Referrers}}<p>{{.Name}} · {{.Count}}</p>{{end}}</div></div></section>
    <section class="panel library"><div class="section-head"><h2>Son görüntülemeler</h2><span>En yeni 100 kayıt</span></div><div class="table-wrap"><table class="analytics-table"><thead><tr><th>Zaman</th><th>IP</th><th>Sayfa</th><th>Cihaz</th><th>Tarayıcı</th><th>Kaynak</th></tr></thead><tbody>{{range .Analytics.Recent}}<tr><td>{{.Time}}</td><td>{{.IP}}</td><td>{{.Path}}</td><td>{{.Device}}</td><td>{{.Browser}}</td><td>{{.Referrer}}</td></tr>{{else}}<tr><td colspan="6">Henüz görüntüleme yok</td></tr>{{end}}</tbody></table></div><p class="analytics-note">Veriler bu özellik yayına alındıktan sonra başlar. IP ve tarayıcı bilgileri yaklaşık olabilir; reklam engelleyiciler ve JavaScript kapalı tarayıcılar sayılmaz. Kayıtlar 30 gün saklanır.</p></section>
    {{else if eq .ActiveTab "posts"}}
    <section class="intro">
      <div><p class="eyebrow">Yeni blog yazısı</p><h1>Markdown ile yaz, tek dokunuşla yayınla</h1><p class="intro-copy">Tarih, bağlantı, kategori ve etiketler içeriğine göre otomatik hazırlanır.</p></div>
      <div class="status"><span class="status-dot"></span> Yazı servisi hazır</div>
    </section>

    <div class="workspace post-workspace">
      <form class="panel composer" id="post-form" method="post" action="/stories-api/posts">
        <div class="section-head"><h2>Yazı</h2><span>Taslak bu cihazda saklanır</span></div>
        <div class="fields">
          <label class="field">
            <span class="label-row"><span class="label">Başlık</span><span class="counter"><b id="post-title-count">0</b>/160</span></span>
            <input class="control" id="post-title" name="title" required maxlength="160" autocomplete="off" placeholder="Yazının dikkat çekici başlığı">
          </label>
          <label class="field">
            <span class="label-row"><span class="label">Markdown içerik</span><span class="counter"><b id="post-body-count">0</b> karakter</span></span>
            <span>
              <span class="markdown-tools" aria-label="Markdown araçları">
                <button class="markdown-tool" type="button" data-before="## " data-after="" title="Başlık">H2</button>
                <button class="markdown-tool" type="button" data-before="**" data-after="**" title="Kalın"><b>B</b></button>
                <button class="markdown-tool" type="button" data-before="_" data-after="_" title="İtalik"><i>I</i></button>
                <button class="markdown-tool" type="button" data-before="[" data-after="](https://)" title="Bağlantı">↗</button>
                <button class="markdown-tool" type="button" data-before="- " data-after="" title="Liste">≡</button>
                <button class="markdown-tool" type="button" data-before="> " data-after="" title="Alıntı">❞</button>
                <button class="markdown-tool" type="button" data-before="~~~\n" data-after="\n~~~" title="Kod bloğu">&lt;/&gt;</button>
              </span>
              <textarea class="control markdown-editor" id="post-body" name="body" required maxlength="200000" spellcheck="true" placeholder="# Giriş&#10;&#10;Yazını Markdown formatında buraya yaz…"></textarea>
            </span>
          </label>
          <div class="metadata-box" aria-live="polite">
            <div class="metadata-item"><small>Tarih</small><strong id="post-date">Bugün · otomatik</strong></div>
            <div class="metadata-item"><small>Kategori</small><strong id="post-category">Genel</strong></div>
            <div class="metadata-item"><small>Etiketler</small><strong id="post-tags">İçeriğe göre</strong></div>
          </div>
          <p class="help">Kategori ve etiketler yerleşik içerik analizine göre belirlenir; ayrıca bir API anahtarı gerekmez.</p>
          <div class="form-error" id="post-error" role="alert"></div>
          <div class="publish-state" id="post-state" role="status"></div>
          <div class="publish-row">
            <p class="publish-note">Dosya adı ve yayın tarihi otomatik oluşturulur.<br>Yayınlama genellikle bir dakika içinde tamamlanır.</p>
            <button class="publish" id="post-publish" type="submit">Yazıyı yayınla</button>
          </div>
        </div>
      </form>

      <aside class="panel preview-panel">
        <div class="preview-label"><span>Canlı önizleme</span><span>Blogdaki yaklaşık görünüm</span></div>
        <article class="article-preview">
          <div class="article-preview-meta"><span class="article-preview-category" id="post-preview-category">Genel</span><span id="post-preview-date">Bugün</span></div>
          <h1 id="post-preview-title">Yazının başlığı</h1>
          <div class="article-preview-body" id="post-preview-body"><p class="article-placeholder">Markdown içeriğini yazdıkça önizleme burada güncellenir.</p></div>
        </article>
        <p class="preview-tip">Önizleme hızlı bir taslaktır; kod vurgulama gibi ayrıntılar canlı sitede tamamlanır.</p>
      </aside>
    </div>

    <section class="panel library">
      <div class="section-head"><h2>Panelden yayınlanan yazılar</h2><span>{{len .Posts}} yazı</span></div>
      <div class="library-grid">
        {{range .Posts}}
        <a class="post-card" href="{{.URL}}" target="_blank" rel="noopener">
          <span class="post-icon">▤</span>
          <span class="story-info"><strong>{{.Title}}</strong><span>{{.Category}} · {{.Date}}</span></span>
          <span class="post-open">↗</span>
        </a>
        {{else}}
        <div class="empty"><strong>Henüz panelden yayınlanan yazı yok</strong>İlk Markdown yazını yukarıdaki düzenleyiciden yayınlayabilirsin.</div>
        {{end}}
      </div>
    </section>
    {{else}}
    <section class="intro">
      <div><p class="eyebrow">Yeni paylaşım</p><h1>Bir hikâye oluştur</h1><p class="intro-copy">İçeriğini ekle, önizle ve tek dokunuşla yayınla.</p></div>
      <div class="status"><span class="status-dot"></span> Hikâye servisi hazır</div>
    </section>

    <div class="workspace">
      <form class="panel composer" id="story-form" method="post" action="/stories-api" enctype="multipart/form-data">
        <div class="section-head"><h2>İçerik</h2><span>Taslak otomatik kaydedilir</span></div>

        <div class="type-switch" role="radiogroup" aria-label="Hikâye türü">
          <label class="type-option"><input type="radio" name="type" value="text" checked><span><b class="type-icon">Aa</b> Metin</span></label>
          <label class="type-option"><input type="radio" name="type" value="image"><span><b class="type-icon">▧</b> Fotoğraf</span></label>
          <label class="type-option"><input type="radio" name="type" value="link"><span><b class="type-icon">↗</b> Bağlantı</span></label>
        </div>

        <div class="fields">
          <label class="field">
            <span class="label-row"><span class="label">Ana metin</span><span class="counter"><b id="text-count">0</b>/1000</span></span>
            <textarea class="control" id="text" name="text" required maxlength="1000" placeholder="Ne paylaşmak istiyorsun?"></textarea>
          </label>

          <div class="field" data-types="image" hidden>
            <span class="label">Fotoğraf</span>
            <label class="upload" id="upload-zone">
              <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
              <span><span class="upload-icon">＋</span><strong id="upload-title">Fotoğraf seç veya buraya bırak</strong><small>JPEG, PNG, WebP veya GIF · en fazla 10 MB</small></span>
            </label>
          </div>

          <div class="field" data-types="text,link">
            <span class="label">Arka plan</span>
            <div class="presets" aria-label="Arka plan seçenekleri">
              <button class="preset active" type="button" aria-label="Gece moru" data-bg="linear-gradient(160deg, #171824, #30215c)" style="background:linear-gradient(160deg,#171824,#30215c)"></button>
              <button class="preset" type="button" aria-label="Gün batımı" data-bg="linear-gradient(155deg, #ec6b62, #7f3fc7)" style="background:linear-gradient(155deg,#ec6b62,#7f3fc7)"></button>
              <button class="preset" type="button" aria-label="Okyanus" data-bg="linear-gradient(155deg, #0c6973, #17224d)" style="background:linear-gradient(155deg,#0c6973,#17224d)"></button>
              <button class="preset" type="button" aria-label="Orman" data-bg="linear-gradient(155deg, #176b54, #17251f)" style="background:linear-gradient(155deg,#176b54,#17251f)"></button>
              <button class="preset" type="button" aria-label="Kömür" data-bg="linear-gradient(155deg, #30303a, #111118)" style="background:linear-gradient(155deg,#30303a,#111118)"></button>
            </div>
          </div>

          <div class="two-col" data-types="link" hidden>
            <label class="field"><span class="label">Bağlantı</span><input class="control" id="link" name="link" placeholder="/posts/… veya https://…"></label>
            <label class="field"><span class="label">Düğme metni</span><input class="control" id="link-label" name="link_label" maxlength="80" value="Aç"></label>
          </div>

          <details>
            <summary>İsteğe bağlı alanlar</summary>
            <div class="two-col">
              <label class="field"><span class="label-row"><span class="label">Kart başlığı</span><span class="optional">İsteğe bağlı</span></span><input class="control" id="title" name="title" maxlength="120" placeholder="Ana sayfadaki kısa başlık"></label>
              <label class="field"><span class="label-row"><span class="label">Alt metin</span><span class="optional">İsteğe bağlı</span></span><input class="control" id="subtext" name="subtext" maxlength="1000" placeholder="Kısa bir açıklama"></label>
            </div>
            <label class="field" data-types="text,link"><span class="label">Özel CSS arka planı</span><input class="control" id="bg" name="bg" maxlength="500" value="linear-gradient(160deg, #171824, #30215c)"></label>
          </details>

          <div class="form-error" id="form-error" role="alert"></div>
          <div class="publish-row">
            <p class="publish-note">Yayın saati otomatik eklenir.<br>Hikâye 24 saat boyunca yeni görünür.</p>
            <button class="publish" id="publish" type="submit">Şimdi yayınla</button>
          </div>
        </div>
      </form>

      <aside class="panel preview-panel">
        <div class="preview-label"><span>Canlı önizleme</span><span>Takipçilerinin göreceği biçim</span></div>
        <div class="story-preview" id="preview">
          <img class="preview-image" id="preview-image" alt="Seçilen fotoğrafın önizlemesi" hidden>
          <div class="progress"></div>
          <div class="story-head"><span class="avatar"></span><span class="user">fmert<small>Şimdi</small></span><span class="badge" id="preview-badge">METİN</span></div>
          <div class="preview-content"><strong id="preview-text">Hikâyen burada görünecek</strong><p id="preview-subtext">Yazdıkça önizleme anında güncellenir.</p></div>
          <div class="preview-cta" id="preview-cta" hidden>Bağlantıyı aç ↑</div>
        </div>
        <p class="preview-tip">İpucu: Kısa ve net metinler mobil ekranda daha güçlü görünür.</p>
      </aside>
    </div>

    <section class="panel library">
      <div class="section-head"><h2>Yayınlanan hikâyeler</h2><span>{{len .Stories}} hikâye</span></div>
      <div class="library-grid">
        {{range .Stories}}
        <article class="story-card" data-posted="{{.Posted}}">
          <div class="story-thumb" data-image="{{.Image}}" data-bg="{{.BG}}"></div>
          <div class="story-info">
            <strong>{{if .Title}}{{.Title}}{{else}}{{.Text}}{{end}}</strong>
            <span>{{.Text}}</span>
            <div class="story-meta"><span class="story-state">Yeni</span><time>{{.Posted}}</time></div>
          </div>
          <form class="delete-form" method="post" action="/stories-api/delete"><input type="hidden" name="id" value="{{.ID}}"><button class="delete" title="Hikâyeyi sil" aria-label="Hikâyeyi sil">×</button></form>
        </article>
        {{else}}
        <div class="empty"><strong>Henüz hikâye yok</strong>İlk hikâyeni yukarıdaki oluşturucudan yayınlayabilirsin.</div>
        {{end}}
      </div>
    </section>
    {{end}}
  </main>
  <div class="toast" id="toast" role="status"></div>

  {{if eq .ActiveTab "posts"}}
  <script>
    (function(){
      'use strict';
      var form=document.getElementById('post-form');
      var title=document.getElementById('post-title');
      var body=document.getElementById('post-body');
      var publish=document.getElementById('post-publish');
      var error=document.getElementById('post-error');
      var state=document.getElementById('post-state');
      var draftKey='fmert-post-draft-v1';
      var metadataTimer=0;

      function escapeHTML(value){return value.replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})}
      function inlineMarkdown(value){
        return value
          .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
          .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
          .replace(/_([^_]+)_/g,'<em>$1</em>')
          .replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
      }
      function renderMarkdown(source){
        if(!source.trim())return '<p class="article-placeholder">Markdown içeriğini yazdıkça önizleme burada güncellenir.</p>';
        var lines=escapeHTML(source).split('\n'),html=[],inCode=false,inList=false,paragraph=[];
        function flushParagraph(){if(paragraph.length){html.push('<p>'+inlineMarkdown(paragraph.join(' '))+'</p>');paragraph=[]}}
        function closeList(){if(inList){html.push('</ul>');inList=false}}
        lines.forEach(function(line){
          if(/^\s*~~~/.test(line)){flushParagraph();closeList();html.push(inCode?'</code></pre>':'<pre><code>');inCode=!inCode;return}
          if(inCode){html.push(line+'\n');return}
          if(!line.trim()){flushParagraph();closeList();return}
          var heading=line.match(/^(#{1,3})\s+(.+)$/);if(heading){flushParagraph();closeList();var level=Math.min(3,heading[1].length+1);html.push('<h'+level+'>'+inlineMarkdown(heading[2])+'</h'+level+'>');return}
          var item=line.match(/^\s*[-*]\s+(.+)$/);if(item){flushParagraph();if(!inList){html.push('<ul>');inList=true}html.push('<li>'+inlineMarkdown(item[1])+'</li>');return}
          var quote=line.match(/^&gt;\s?(.*)$/);if(quote){flushParagraph();closeList();html.push('<blockquote>'+inlineMarkdown(quote[1])+'</blockquote>');return}
          paragraph.push(line.trim());
        });
        flushParagraph();closeList();if(inCode)html.push('</code></pre>');return html.join('');
      }
      function syncPreview(){
        var titleValue=title.value.trim();
        document.getElementById('post-preview-title').textContent=titleValue||'Yazının başlığı';
        document.getElementById('post-preview-body').innerHTML=renderMarkdown(body.value);
        document.getElementById('post-title-count').textContent=title.value.length;
        document.getElementById('post-body-count').textContent=body.value.length.toLocaleString('tr-TR');
        try{localStorage.setItem(draftKey,JSON.stringify({title:title.value,body:body.value}))}catch(e){}
        clearTimeout(metadataTimer);metadataTimer=setTimeout(loadMetadata,450);
      }
      function loadMetadata(){
        var values=new URLSearchParams();values.set('title',title.value);values.set('body',body.value);
        fetch('/stories-api/posts/metadata',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:values.toString()})
          .then(function(response){if(!response.ok)throw new Error();return response.json()})
          .then(function(data){document.getElementById('post-category').textContent=data.category;document.getElementById('post-preview-category').textContent=data.category;document.getElementById('post-tags').textContent=(data.tags||[]).join(', ')||'İçeriğe göre'})
          .catch(function(){});
      }
      function showError(message){error.textContent=message;error.classList.add('show');publish.disabled=false;publish.textContent='Yazıyı yayınla'}
      function showState(message,type){state.className='publish-state show'+(type?' '+type:'');state.innerHTML=message}
      function pollStatus(file,url,attempt){
        if(attempt>90){showState('Yazı kaydedildi ancak yayınlama beklenenden uzun sürüyor. Biraz sonra siteyi kontrol edebilirsin.','');publish.disabled=false;publish.textContent='Yazıyı yayınla';return}
        fetch('/stories-api/posts/status',{cache:'no-store'}).then(function(response){if(!response.ok)throw new Error();return response.json()}).then(function(data){
          if(data.file===file&&data.state==='published'){showState('Yazı yayında. <a href="'+url+'" target="_blank" rel="noopener">Yazıyı aç ↗</a>','success');publish.disabled=false;publish.textContent='Yayınlandı';return}
          if(data.file===file&&data.state==='failed'){showState(escapeHTML(data.message||'Yayınlama sırasında bir sorun oluştu.'),'error');publish.disabled=false;publish.textContent='Yeniden dene';return}
          showState(escapeHTML(data.message||'Blog hazırlanıyor…'),'');setTimeout(function(){pollStatus(file,url,attempt+1)},1000);
        }).catch(function(){setTimeout(function(){pollStatus(file,url,attempt+1)},1500)});
      }

      try{var draft=JSON.parse(localStorage.getItem(draftKey)||'null');if(draft){title.value=draft.title||'';body.value=draft.body||''}}catch(e){}
      document.getElementById('post-preview-date').textContent=new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'});
      form.addEventListener('input',function(){error.classList.remove('show');syncPreview()});
      document.querySelectorAll('.markdown-tool').forEach(function(button){button.addEventListener('click',function(){
        var start=body.selectionStart,end=body.selectionEnd,before=button.dataset.before.split('\\n').join('\n'),after=button.dataset.after.split('\\n').join('\n'),selected=body.value.slice(start,end);
        body.setRangeText(before+selected+after,start,end,'end');body.focus();syncPreview();
      })});
      form.addEventListener('submit',function(event){
        event.preventDefault();error.classList.remove('show');state.className='publish-state';publish.disabled=true;publish.textContent='Kaydediliyor…';
        fetch(form.action,{method:'POST',body:new URLSearchParams(new FormData(form))}).then(function(response){if(!response.ok)return response.text().then(function(message){throw new Error(message.trim())});return response.json()}).then(function(data){
          try{localStorage.removeItem(draftKey)}catch(e){}publish.textContent='Yayınlanıyor…';showState('Yazı kaydedildi, blog hazırlanıyor…','');pollStatus(data.file,data.url,0);
        }).catch(function(reason){showError(reason.message||'Yazı kaydedilemedi.')});
      });
      syncPreview();
    })();
  </script>
  {{else if eq .ActiveTab "stories"}}
  <script>
    (function(){
      'use strict';
      var form=document.getElementById('story-form');
      var textInput=document.getElementById('text');
      var subtextInput=document.getElementById('subtext');
      var imageInput=document.getElementById('image');
      var linkInput=document.getElementById('link');
      var linkLabel=document.getElementById('link-label');
      var bgInput=document.getElementById('bg');
      var preview=document.getElementById('preview');
      var previewImage=document.getElementById('preview-image');
      var previewText=document.getElementById('preview-text');
      var previewSubtext=document.getElementById('preview-subtext');
      var previewBadge=document.getElementById('preview-badge');
      var previewCTA=document.getElementById('preview-cta');
      var uploadZone=document.getElementById('upload-zone');
      var uploadTitle=document.getElementById('upload-title');
      var publish=document.getElementById('publish');
      var error=document.getElementById('form-error');
      var imageURL='';
      var draftKey='fmert-story-draft-v2';
      var badges={text:'METİN',image:'FOTOĞRAF',link:'BAĞLANTI'};

      function currentType(){return form.querySelector('input[name="type"]:checked').value}
      function applies(el,type){return (el.dataset.types||'').split(',').indexOf(type)!==-1}
      function syncType(){
        var type=currentType();
        form.querySelectorAll('[data-types]').forEach(function(el){el.hidden=!applies(el,type)});
        imageInput.required=type==='image';
        linkInput.required=type==='link';
        previewBadge.textContent=badges[type];
        previewCTA.hidden=type!=='link';
        previewImage.hidden=type!=='image'||!imageURL;
        syncPreview();
      }
      function syncPreview(){
        var type=currentType();
        var main=textInput.value.trim();
        var sub=subtextInput.value.trim();
        previewText.textContent=main||'Hikâyen burada görünecek';
        previewSubtext.textContent=sub||(main?'':'Yazdıkça önizleme anında güncellenir.');
        previewSubtext.hidden=!sub&&!!main;
        previewCTA.textContent=(linkLabel.value.trim()||'Aç')+' ↑';
        if(type!=='image') preview.style.background=bgInput.value||'linear-gradient(160deg, #171824, #30215c)';
        document.getElementById('text-count').textContent=textInput.value.length;
      }
      function saveDraft(){
        var draft={type:currentType(),text:textInput.value,title:document.getElementById('title').value,subtext:subtextInput.value,link:linkInput.value,linkLabel:linkLabel.value,bg:bgInput.value};
        try{localStorage.setItem(draftKey,JSON.stringify(draft))}catch(e){}
      }
      function restoreDraft(){
        try{
          var draft=JSON.parse(localStorage.getItem(draftKey)||'null');
          if(!draft)return;
          var radio=form.querySelector('input[name="type"][value="'+draft.type+'"]');
          if(radio)radio.checked=true;
          textInput.value=draft.text||'';document.getElementById('title').value=draft.title||'';subtextInput.value=draft.subtext||'';linkInput.value=draft.link||'';linkLabel.value=draft.linkLabel||'Aç';bgInput.value=draft.bg||bgInput.value;
        }catch(e){}
      }
      function selectFile(file){
        if(!file)return;
        if(file.size>10*1024*1024){showError('Fotoğraf 10 MB sınırını aşıyor.');imageInput.value='';return}
        if(imageURL)URL.revokeObjectURL(imageURL);
        imageURL=URL.createObjectURL(file);previewImage.src=imageURL;previewImage.hidden=false;uploadTitle.textContent=file.name;syncPreview();
      }
      function showError(message){error.textContent=message;error.classList.add('show');error.scrollIntoView({behavior:'smooth',block:'nearest'})}
      function showToast(message){var toast=document.getElementById('toast');toast.textContent=message;toast.classList.add('show');setTimeout(function(){toast.classList.remove('show')},2200)}

      restoreDraft();syncType();
      form.addEventListener('input',function(){error.classList.remove('show');syncPreview();saveDraft()});
      form.addEventListener('change',function(event){if(event.target===imageInput)selectFile(imageInput.files[0]);syncType();saveDraft()});
      form.querySelectorAll('.preset').forEach(function(button){button.addEventListener('click',function(){form.querySelectorAll('.preset').forEach(function(item){item.classList.remove('active')});button.classList.add('active');bgInput.value=button.dataset.bg;syncPreview();saveDraft()})});
      ['dragenter','dragover'].forEach(function(name){uploadZone.addEventListener(name,function(event){event.preventDefault();uploadZone.classList.add('drag')})});
      ['dragleave','drop'].forEach(function(name){uploadZone.addEventListener(name,function(event){event.preventDefault();uploadZone.classList.remove('drag')})});
      uploadZone.addEventListener('drop',function(event){var file=event.dataTransfer.files[0];if(file){var transfer=new DataTransfer();transfer.items.add(file);imageInput.files=transfer.files;selectFile(file)}});
      form.addEventListener('submit',function(event){
        event.preventDefault();error.classList.remove('show');publish.disabled=true;publish.textContent='Yayınlanıyor…';
        fetch(form.action,{method:'POST',body:new FormData(form)}).then(function(response){if(!response.ok)return response.text().then(function(message){throw new Error(message.trim())});try{localStorage.removeItem(draftKey)}catch(e){}showToast('Hikâye yayınlandı');setTimeout(function(){location.reload()},450)}).catch(function(reason){showError(reason.message||'Hikâye yayınlanamadı.');publish.disabled=false;publish.textContent='Şimdi yayınla'});
      });
      document.querySelectorAll('.delete-form').forEach(function(deleteForm){deleteForm.addEventListener('submit',function(event){if(!confirm('Bu hikâyeyi kalıcı olarak silmek istiyor musun?'))event.preventDefault()})});
      document.querySelectorAll('.story-card').forEach(function(card){
        var thumb=card.querySelector('.story-thumb');if(thumb.dataset.image)thumb.style.backgroundImage='url("'+thumb.dataset.image+'")';else if(thumb.dataset.bg)thumb.style.background=thumb.dataset.bg;
        var date=new Date(card.dataset.posted),hours=(Date.now()-date.getTime())/3600000,state=card.querySelector('.story-state');if(hours>=24){state.textContent='Arşiv';state.classList.add('expired')}
        var time=card.querySelector('time');time.textContent=isNaN(date.getTime())?'':date.toLocaleString('tr-TR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      });
    })();
  </script>
  {{end}}
</body>
</html>`))
