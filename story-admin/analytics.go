package main

import (
	"bufio"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	maxAnalyticsDayBytes   = 10 << 20
	maxAnalyticsTotalBytes = 100 << 20
)

type Visit struct {
	Time     string `json:"time"`
	IP       string `json:"ip"`
	Path     string `json:"path"`
	Device   string `json:"device"`
	Browser  string `json:"browser"`
	Referrer string `json:"referrer"`
}
type Count struct {
	Name  string
	Count int
}
type AnalyticsSummary struct {
	Views, UniqueIPs, Today             int
	Pages, Devices, Browsers, Referrers []Count
	Recent                              []Visit
}

func (a *app) recordVisit(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if retry := a.visitLimiter.allow(clientIP(r), time.Now(), 60, 600, time.Minute); retry > 0 {
		tooManyRequests(w, retry)
		return
	}
	if !sameOriginLike(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2048)
	var input struct {
		Path     string `json:"path"`
		Referrer string `json:"referrer"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil || len(input.Path) > 500 || !strings.HasPrefix(input.Path, "/") || strings.HasPrefix(input.Path, "//") {
		http.Error(w, "invalid visit", http.StatusBadRequest)
		return
	}
	path, err := url.Parse(input.Path)
	if err != nil || path.Host != "" || path.Scheme != "" || strings.HasPrefix(path.Path, "/stories-") {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	visit := visitFromRequest(r, path.Path, input.Referrer)
	b, _ := json.Marshal(visit)
	b = append(b, '\n')
	day := visit.Time[:10] + ".jsonl"
	dir := filepath.Join(a.dataDir, "analytics")
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, "storage error", 500)
		return
	}
	// Check actual files under the write lock so the quota survives restarts
	// and concurrent requests cannot each reserve the same remaining space.
	full, err := analyticsStorageFull(dir, day, int64(len(b)))
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	if full {
		http.Error(w, "analytics storage limit reached", http.StatusServiceUnavailable)
		return
	}
	file, err := os.OpenFile(filepath.Join(dir, day), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		http.Error(w, "storage error", 500)
		return
	}
	defer file.Close()
	if _, err = file.Write(b); err != nil {
		http.Error(w, "storage error", 500)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func analyticsStorageFull(dir, day string, incoming int64) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, err
	}
	total := incoming
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return false, err
		}
		if entry.Name() == day && info.Size()+incoming > maxAnalyticsDayBytes {
			return true, nil
		}
		total += info.Size()
		if total > maxAnalyticsTotalBytes {
			return true, nil
		}
	}
	return incoming > maxAnalyticsDayBytes, nil
}

func visitFromRequest(r *http.Request, path, referrer string) Visit {
	ua := r.UserAgent()
	if len(ua) > 1000 {
		ua = ua[:1000]
	}
	return Visit{Time: time.Now().UTC().Format(time.RFC3339), IP: clientIP(r), Path: path, Device: deviceName(ua), Browser: browserName(ua), Referrer: referrerName(referrer)}
}

func clientIP(r *http.Request) string {
	// Caddy is the sole local proxy. It appends the actual peer to X-Forwarded-For.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "unknown"
	}
	if host == "127.0.0.1" || host == "::1" || os.Getenv("TRUST_PROXY_HEADERS") == "true" {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for i := len(parts) - 1; i >= 0; i-- {
			if ip := net.ParseIP(strings.TrimSpace(parts[i])); ip != nil {
				return ip.String()
			}
		}
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return "unknown"
}
func deviceName(ua string) string {
	switch {
	case strings.Contains(ua, "iPad") || strings.Contains(ua, "Tablet"):
		return "Tablet"
	case strings.Contains(ua, "Mobile") || strings.Contains(ua, "Android") || strings.Contains(ua, "iPhone"):
		return "Mobil"
	case ua == "":
		return "Bilinmiyor"
	default:
		return "Masaüstü"
	}
}
func browserName(ua string) string {
	switch {
	case strings.Contains(ua, "Edg/"):
		return "Edge"
	case strings.Contains(ua, "Firefox/"):
		return "Firefox"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "CriOS/"):
		return "Chrome"
	case strings.Contains(ua, "Safari/"):
		return "Safari"
	default:
		return "Diğer"
	}
}
func referrerName(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return "Doğrudan / bilinmiyor"
	}
	host := strings.ToLower(u.Hostname())
	if host == "fmert.me" || host == "www.fmert.me" {
		return "fmert.me"
	}
	if len(host) > 100 {
		return "Diğer"
	}
	return host
}
func sortedCounts(m map[string]int) []Count {
	out := make([]Count, 0, len(m))
	for k, v := range m {
		out = append(out, Count{k, v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count == out[j].Count {
			return out[i].Name < out[j].Name
		}
		return out[i].Count > out[j].Count
	})
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}
func (a *app) analyticsSummary() (AnalyticsSummary, error) {
	var result AnalyticsSummary
	dir := filepath.Join(a.dataDir, "analytics")
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	now := time.Now().UTC()
	cutoff := now.AddDate(0, 0, -30)
	ips := map[string]bool{}
	pages := map[string]int{}
	devices := map[string]int{}
	browsers := map[string]int{}
	refs := map[string]int{}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		day, err := time.Parse("2006-01-02", strings.TrimSuffix(name, ".jsonl"))
		if err != nil {
			continue
		}
		if day.Before(cutoff.Add(-24 * time.Hour)) {
			_ = os.Remove(filepath.Join(dir, name))
			continue
		}
		file, err := os.Open(filepath.Join(dir, name))
		if err != nil {
			return result, err
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			var v Visit
			if json.Unmarshal(scanner.Bytes(), &v) != nil {
				continue
			}
			at, err := time.Parse(time.RFC3339, v.Time)
			if err != nil || at.Before(cutoff) {
				continue
			}
			result.Views++
			if v.IP != "unknown" {
				ips[v.IP] = true
			}
			if at.In(time.FixedZone("TRT", 3*3600)).Format("2006-01-02") == now.In(time.FixedZone("TRT", 3*3600)).Format("2006-01-02") {
				result.Today++
			}
			pages[v.Path]++
			devices[v.Device]++
			browsers[v.Browser]++
			refs[v.Referrer]++
			result.Recent = append(result.Recent, v)
			if len(result.Recent) > 200 {
				sort.Slice(result.Recent, func(i, j int) bool { return result.Recent[i].Time > result.Recent[j].Time })
				result.Recent = result.Recent[:100]
			}
		}
		scanErr := scanner.Err()
		file.Close()
		if scanErr != nil {
			return result, scanErr
		}
	}
	result.UniqueIPs = len(ips)
	result.Pages = sortedCounts(pages)
	result.Devices = sortedCounts(devices)
	result.Browsers = sortedCounts(browsers)
	result.Referrers = sortedCounts(refs)
	sort.Slice(result.Recent, func(i, j int) bool { return result.Recent[i].Time > result.Recent[j].Time })
	if len(result.Recent) > 100 {
		result.Recent = result.Recent[:100]
	}
	for i := range result.Recent {
		at, _ := time.Parse(time.RFC3339, result.Recent[i].Time)
		result.Recent[i].Time = at.In(time.FixedZone("TRT", 3*3600)).Format("02.01.2006 15:04")
	}
	return result, nil
}
