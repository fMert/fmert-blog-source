package main

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

type requestWindow struct {
	started time.Time
	count   int
}

// Each endpoint owns its limiter. A global budget also bounds requests spread
// across many IPs. Expired entries are reclaimed and the map has a hard cap.
type requestLimiter struct {
	mu     sync.Mutex
	byIP   map[string]requestWindow
	global requestWindow
}

func (l *requestLimiter) allow(ip string, now time.Time, perIP, total int, period time.Duration) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.byIP == nil {
		l.byIP = make(map[string]requestWindow)
	}
	if l.global.started.IsZero() || !now.Before(l.global.started.Add(period)) {
		l.global = requestWindow{started: now}
	}
	var retry time.Duration
	if l.global.count >= total {
		retry = l.global.started.Add(period).Sub(now)
	}
	window, exists := l.byIP[ip]
	if exists && now.Before(window.started.Add(period)) && window.count >= perIP {
		if wait := window.started.Add(period).Sub(now); wait > retry {
			retry = wait
		}
	}
	if retry > 0 {
		return retry
	}
	if !exists || !now.Before(window.started.Add(period)) {
		for key, old := range l.byIP {
			if !now.Before(old.started.Add(period)) {
				delete(l.byIP, key)
			}
		}
		if len(l.byIP) >= 4096 {
			return period
		}
		window = requestWindow{started: now}
	}
	window.count++
	l.byIP[ip] = window
	l.global.count++
	return 0
}

func tooManyRequests(w http.ResponseWriter, retry time.Duration) {
	seconds := int64((retry + time.Second - 1) / time.Second)
	w.Header().Set("Retry-After", strconv.FormatInt(seconds, 10))
	w.Header().Set("Cache-Control", "no-store")
	http.Error(w, "Çok fazla istek. Lütfen daha sonra tekrar dene.", http.StatusTooManyRequests)
}
