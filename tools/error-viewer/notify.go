package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

/*===== Notifications =====*/

// notifier posts a short message to a chat webhook (NOTIFY_URL) when a kind of error shows up that is new, or back
// after notifyQuiet of silence. The store's writer decides which events those are (worthAnnouncing); a kind that keeps
// failing is announced once, not once per event.
//
// The body is `{"text": "…"}`, which Slack, Mattermost, Rocket.Chat and Google Chat webhooks take as they are. With
// NOTIFY_CHAT_ID it also carries `chat_id`, which makes it a `sendMessage` call for a Telegram-style bot API.
type notifier struct {
	url    string
	chatID string
	base   *url.URL
	client *http.Client
	limit  *rateLimiter
	queue  chan eventRow
	done   chan struct{}
	log    *slog.Logger
	// Stops requests in flight at shutdown, so a webhook that doesn't answer can't hold the process.
	ctx context.Context
}

const (
	// Five messages at once, then one a minute: an incident that breaks everything must not flood the chat. What was
	// held back is counted in the next message.
	notifyPerMinute = 1
	notifyBurst     = 5
	notifyQueue     = 50
)

func newNotifier(ctx context.Context, cfg config, log *slog.Logger) *notifier {
	n := &notifier{
		url:    cfg.NotifyURL.String(),
		chatID: cfg.NotifyChatID,
		base:   cfg.BaseURL,
		client: &http.Client{Timeout: 10 * time.Second},
		limit:  newRateLimiter(notifyPerMinute, notifyBurst),
		queue:  make(chan eventRow, notifyQueue),
		done:   make(chan struct{}),
		log:    log,
		ctx:    ctx,
	}
	go n.run()
	return n
}

// offer queues an event for a message and never blocks the store's writer: with the queue full, the event is only
// not announced.
func (n *notifier) offer(row eventRow) {
	select {
	case n.queue <- row:
	default:
	}
}

// close stops the sender. Call it after the store has closed, since the store's writer calls offer.
func (n *notifier) close() {
	close(n.queue)
	<-n.done
}

func (n *notifier) run() {
	defer close(n.done)
	held := 0
	for row := range n.queue {
		if ok, _ := n.limit.take("", 1, time.Now()); !ok {
			held++
			continue
		}
		if err := n.send(n.text(row, held)); err != nil {
			if n.ctx.Err() == nil {
				n.log.Warn("could not send a notification", "err", err)
			}
			continue
		}
		held = 0
	}
}

// text is the message: what failed, where, and the link to the event.
func (n *notifier) text(row eventRow, held int) string {
	var b strings.Builder
	if row.Environment != "" {
		fmt.Fprintf(&b, "[%s] ", row.Environment)
	}
	b.WriteString(row.Title)

	details := []string{row.KindLabel()}
	if where := strings.TrimSpace(row.Method + " " + row.Path); where != "" {
		details = append(details, where)
	}
	if row.Release != "" {
		details = append(details, "release "+row.Release)
	}
	b.WriteString("\n" + strings.Join(details, " · "))
	b.WriteString("\n" + n.base.JoinPath("events", row.ID).String())
	if held > 0 {
		fmt.Fprintf(&b, "\n%d more new kinds of errors were not announced. See the viewer.", held)
	}
	return b.String()
}

func (n *notifier) send(text string) error {
	body := map[string]string{"text": text}
	if n.chatID != "" {
		body["chat_id"] = n.chatID
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(n.ctx, http.MethodPost, n.url, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := n.client.Do(req)
	if err != nil {
		// The URL holds the webhook's secret; Go's error would print it.
		if urlErr, ok := err.(*url.Error); ok {
			return urlErr.Err
		}
		return err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("the webhook answered %s", res.Status)
	}
	return nil
}
