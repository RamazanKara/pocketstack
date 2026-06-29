package compose

import "testing"

func TestParsePortNumberRangesAndJunk(t *testing.T) {
	cases := map[string]int{
		"80":         80,
		"3000-3005":  3000,
		" 8080 ":     8080,
		"":           0,
		"not-a-port": 0,
		"5173/tcp":   0, // protocol is split off before this helper is called
	}
	for input, want := range cases {
		if got := parsePortNumber(input); got != want {
			t.Errorf("parsePortNumber(%q) = %d, want %d", input, got, want)
		}
	}
}
