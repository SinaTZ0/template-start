// Package notify sends the tool's alerts to a chat: the webhook the error viewer already posts to
// (ERROR_VIEWER_NOTIFY_URL, with ERROR_VIEWER_NOTIFY_CHAT_ID for a Telegram-style bot API), so one setting covers
// errors in the app and trouble on the server. The tool reads both from .env; the viewer doesn't have to be running.
package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"deploy/internal/envfile"
)

// Configured reports whether .env names a chat to send to.
func Configured(env string) bool { return envfile.Get(env, "ERROR_VIEWER_NOTIFY_URL") != "" }

// Send posts text to the chat. The body is the one the error viewer sends: `text`, and `chat_id` when one is set.
func Send(env, text string) error {
	url := envfile.Get(env, "ERROR_VIEWER_NOTIFY_URL")
	if url == "" {
		return fmt.Errorf("no chat is set (ERROR_VIEWER_NOTIFY_URL in .env)")
	}
	body := map[string]string{"text": text}
	if chat := envfile.Get(env, "ERROR_VIEWER_NOTIFY_CHAT_ID"); chat != "" {
		body["chat_id"] = chat
	}
	payload, _ := json.Marshal(body)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(payload))
	if err != nil {
		// The URL holds a bot's token: never in an error that reaches a log.
		return fmt.Errorf("the chat didn't answer")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("the chat answered %d", resp.StatusCode)
	}
	return nil
}
