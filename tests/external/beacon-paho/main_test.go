package main

import (
	"testing"
	"time"
)

func TestCollectIgnoresUnrelatedAndDuplicateTopics(t *testing.T) {
	messages := make(chan delivery, 8)
	messages <- delivery{topic: "meshcore/STO/other/status", payload: []byte(`{}`)}
	messages <- delivery{topic: "fixture/status", payload: []byte(`{"ok":true}`)}
	messages <- delivery{topic: "fixture/status", payload: []byte(`{"ok":true}`)}
	messages <- delivery{topic: "fixture/packets", payload: []byte(`[]`)}
	_, err := collect(messages, make(chan error), "fixture/", map[string]string{
		"status": `{"ok":true}`, "packets": `[]`, "neighbors": `[]`,
	}, false, 10*time.Millisecond)
	if err == nil {
		t.Fatal("unrelated messages and duplicates must not satisfy missing neighbors")
	}
}

func TestCollectRequiresExactPayloadAndRetainFlag(t *testing.T) {
	for _, tc := range []struct {
		name      string
		payload   string
		retained  bool
		wantError bool
	}{
		{"correct", `{"ok":true}`, true, false},
		{"wrong payload", `{"ok":false}`, true, true},
		{"wrong retain", `{"ok":true}`, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			messages := make(chan delivery, 1)
			messages <- delivery{topic: "fixture/status", payload: []byte(tc.payload), retained: tc.retained}
			_, err := collect(messages, make(chan error), "fixture/", map[string]string{"status": `{"ok":true}`}, true, time.Second)
			if (err != nil) != tc.wantError {
				t.Fatalf("unexpected result: %v", err)
			}
		})
	}
}
