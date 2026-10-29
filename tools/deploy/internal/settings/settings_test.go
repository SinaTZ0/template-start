package settings

import "testing"

func TestValidate(t *testing.T) {
	c := Checker{Values: map[string]string{"DOMAIN": "app.test"}, Example: map[string]string{"LOG_LEVEL": "info"}}
	cases := []struct {
		key, value string
		fix        Fix // "" for no problem
	}{
		{"DOMAIN", "example.com", Ask},
		{"DOMAIN", "app.example.com", Ask},
		{"ERRORS_DOMAIN", "app.test", Ask},
		{"ERRORS_DOMAIN", "errors.app.test", ""},
		// Secrets go inside the database URL and the store's JSON config.
		{"POSTGRES_PASSWORD", "a/b+c@d", Ask},
		{"POSTGRES_PASSWORD", "", Gen},
		{"BETTER_AUTH_SECRET", "tooshort", Ask},
		// Compose would expand the `$`.
		{"S3_BUCKET_NAME", "media$x", Ask},
		{"LOG_LEVEL", "loud", Ask},
		{"LOG_LEVEL", "", Gen},
		{"BACKUP_KEEP", "0", Ask},
		// The Dockerfile adds the `/` itself; with a second one, the URLs it builds would have `//`.
		{"NPM_REGISTRY", "https://registry.npmmirror.com/", Ask},
		{"NPM_REGISTRY", "", ""},
		{"SOMETHING_ELSE", "1", Warn},
	}
	for _, tc := range cases {
		problems := c.Validate(tc.key, tc.value, false)
		var got Fix
		if len(problems) > 0 {
			got = problems[0].Fix
		}
		if got != tc.fix {
			t.Errorf("Validate(%s=%q) = %+v, want fix %q", tc.key, tc.value, problems, tc.fix)
		}
	}
}

func TestGenerateMakesHexOfTheKindsLength(t *testing.T) {
	if got := Generate("ERROR_VIEWER_ADMIN_PASSWORD", nil); len(got) != 24 {
		t.Errorf("password:12 gave %d characters", len(got))
	}
	if got := Generate("BETTER_AUTH_SECRET", nil); !secretChars.MatchString(got) || len(got) != 64 {
		t.Errorf("secret:32:32 gave %q", got)
	}
	if got := Generate("S3_BUCKET_NAME", map[string]string{"S3_BUCKET_NAME": "app-media"}); got != "app-media" {
		t.Errorf("default kind gave %q", got)
	}
}
