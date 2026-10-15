package main

import (
	"math"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

/*===== Token Bucket =====*/

// rateLimiter is a token bucket per key (a client IP, or one fixed key for a global cap). A bucket holds up to `burst`
// tokens and refills at `perMinute`.
type rateLimiter struct {
	mu        sync.Mutex
	perSecond float64
	burst     float64
	buckets   map[string]*bucket
	lastSweep time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// maxBuckets bounds the map's memory if very many distinct clients show up between sweeps.
const maxBuckets = 100_000

func newRateLimiter(perMinute, burst int) *rateLimiter {
	return &rateLimiter{
		perSecond: float64(perMinute) / 60,
		burst:     float64(burst),
		buckets:   map[string]*bucket{},
	}
}

// take removes n tokens from key's bucket. When there aren't enough it takes none and returns how long until there
// will be.
func (l *rateLimiter) take(key string, n int, now time.Time) (ok bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now)

	b, found := l.buckets[key]
	if !found {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = math.Min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.perSecond)
	b.last = now

	need := float64(n)
	if b.tokens >= need {
		b.tokens -= need
		return true, 0
	}
	wait := time.Duration((need - b.tokens) / l.perSecond * float64(time.Second))
	return false, max(wait, time.Second)
}

// sweep drops buckets that have refilled completely (they behave exactly like a missing one), once a minute.
func (l *rateLimiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < time.Minute && len(l.buckets) < maxBuckets {
		return
	}
	l.lastSweep = now
	for key, b := range l.buckets {
		if b.tokens+now.Sub(b.last).Seconds()*l.perSecond >= l.burst {
			delete(l.buckets, key)
		}
	}
	if len(l.buckets) >= maxBuckets {
		clear(l.buckets)
	}
}

/*===== Client IP =====*/

// clientIP is the address rate limits count against. Behind Caddy every connection comes from the proxy, which passes
// the visitor's address in X-Real-IP (deploy/Caddyfile). The header is trusted only from a private or loopback
// address (the Docker network), so a client connecting directly can't pick its own bucket.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	if remote.IsLoopback() || remote.IsPrivate() {
		if real, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("X-Real-IP"))); err == nil {
			return real.String()
		}
	}
	return remote.String()
}
