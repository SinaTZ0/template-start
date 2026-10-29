// Package sources checks, before a build, that this server can reach where the build downloads packages from: npm's
// registry (the app's image) and Go's module proxy (the error viewer's). Where one is blocked the build doesn't fail
// fast: pnpm retries for about ten minutes before it gives up. Each has a mirror setting in .env; the check only runs
// while that setting is empty, so a server that chose a mirror, or the default on purpose, is never probed again.
package sources

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// Source is a package source the build downloads from, and the .env setting that points the build at a mirror.
type Source struct {
	Name string // shown in the messages
	What string // what the build downloads from it
	Key  string
	// Mirror is the one offered. Both are run by third parties in China, which is why the tool offers them and never
	// switches by itself; package contents are still checked against the lockfile's and go.sum's hashes.
	Mirror string
	// Default is the value that keeps the source and skips this check.
	Default string
	probe   func(ctx context.Context) string
}

// Blocked is a source this server can't reach, with why.
type Blocked struct {
	Source
	Problem string
}

// Sources lists what the build downloads from.
var Sources = []Source{
	{
		Name: "registry.npmjs.org", What: "npm packages", Key: "NPM_REGISTRY",
		Mirror: "https://registry.npmmirror.com", Default: "https://registry.npmjs.org", probe: probeNpm,
	},
	{
		Name: "proxy.golang.org", What: "Go modules", Key: "GOPROXY",
		Mirror: "https://goproxy.cn", Default: "https://proxy.golang.org,direct", probe: probeGo,
	},
}

// timeout is how long one request may take. A reachable registry answers in well under a second.
const timeout = 5 * time.Second

// Check probes, in parallel, each source whose setting get returns empty, and returns the ones that don't answer.
func Check(get func(key string) string) []Blocked {
	results := make([]string, len(Sources))
	var wg sync.WaitGroup
	for i, s := range Sources {
		if get(s.Key) != "" {
			continue
		}
		wg.Go(func() { results[i] = s.probe(context.Background()) })
	}
	wg.Wait()
	var blocked []Blocked
	for i, problem := range results {
		if problem != "" {
			blocked = append(blocked, Blocked{Sources[i], problem})
		}
	}
	return blocked
}

/*===== npm =====*/

// probeNpm sends a request to every address registry.npmjs.org has, because a block can be partial: on the server
// this was written for, 2 of its 12 addresses answered. One request could land on a good one and pass, while pnpm,
// which spreads its downloads over all of them, hangs. A failed address gets a second try, so one lost packet doesn't
// count as a block. IPv4 only: Docker's default network has no IPv6, so builds connect over IPv4 even where the host
// itself has IPv6.
func probeNpm(ctx context.Context) string {
	const host = "registry.npmjs.org"
	lookup, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIP(lookup, "ip4", host)
	if err != nil || len(ips) == 0 {
		return "its name doesn't resolve on this server"
	}

	failed := make([]bool, len(ips))
	var wg sync.WaitGroup
	for i, ip := range ips {
		wg.Go(func() {
			// Any answer counts: what a block does is answer nothing.
			_, err := get(ctx, "https://"+host+"/-/ping", ip.String())
			if err != nil {
				_, err = get(ctx, "https://"+host+"/-/ping", ip.String())
			}
			failed[i] = err != nil
		})
	}
	wg.Wait()
	n := 0
	for _, f := range failed {
		if f {
			n++
		}
	}
	switch {
	case n == 0:
		return ""
	case n == len(ips):
		return "it doesn't answer from this server"
	default:
		return fmt.Sprintf("%d of its %d addresses don't answer from this server", n, len(ips))
	}
}

/*===== Go =====*/

// goProbe is a module zip large enough that proxy.golang.org redirects it to storage.googleapis.com, which is what
// answers 403 where Google blocks the region; small modules come from proxy.golang.org itself and pass. The error
// viewer's own SQLite driver, so it's one the build really needs; the proxy keeps every version forever.
const goProbe = "https://proxy.golang.org/modernc.org/sqlite/@v/v1.60.1.zip"

func probeGo(ctx context.Context) string {
	status, err := get(ctx, goProbe, "")
	switch {
	case err != nil:
		return "it doesn't answer from this server"
	case status == http.StatusForbidden:
		return "it answers 403 Forbidden (Google blocks some regions)"
	case status >= 400:
		return fmt.Sprintf("it answers HTTP %d", status)
	}
	return ""
}

/*===== Requests =====*/

// get requests url and returns the answer's status, or an error when none comes within the timeout. Only the first
// byte is asked for: the probe needs an answer, not the file. With ip set, it connects there instead of the address
// DNS gives. No proxy from the environment: the build's own downloads don't use it either.
func get(ctx context.Context, url, ip string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	transport := &http.Transport{DisableKeepAlives: true}
	if ip != "" {
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, _ := net.SplitHostPort(addr)
			return (&net.Dialer{}).DialContext(ctx, "tcp4", net.JoinHostPort(ip, port))
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Range", "bytes=0-0")
	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	// Reading the body too: a block can also stall after the headers.
	if _, err := io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16)); err != nil {
		return 0, err
	}
	return resp.StatusCode, nil
}
