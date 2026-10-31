package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type claims struct {
	PublicKey string `json:"publicKey"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	Audience  string `json:"aud"`
}

type delivery struct {
	topic    string
	payload  []byte
	retained bool
}

func main() {
	var (
		brokerURL = flag.String("url", "ws://127.0.0.1:8883/mqtt", "MQTT WebSocket URL")
		username  = flag.String("subscriber", "full", "FULL_ACCESS subscriber username")
		password  = flag.String("password", "secret", "FULL_ACCESS subscriber password")
		audience  = flag.String("audience", "integration", "observer JWT audience")
		iata      = flag.String("iata", "STO", "allowed IATA code")
		timeout   = flag.Duration("timeout", 10*time.Second, "operation timeout")
	)
	flag.Parse()

	if err := run(*brokerURL, *username, *password, *audience, *iata, *timeout); err != nil {
		fmt.Fprintln(os.Stderr, "beacon-paho integration failed:", err)
		os.Exit(1)
	}
	fmt.Println("Beacon/Paho observer, QoS, reconnect and retained replay checks passed")
}

func run(brokerURL, subscriber, password, audience, iata string, timeout time.Duration) error {
	seed := sha256.Sum256([]byte("meshcore-mqtt-broker synthetic external observer"))
	privateKey := ed25519.NewKeyFromSeed(seed[:])
	publicKey := hex.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	token, err := observerToken(privateKey, publicKey, audience, time.Now())
	if err != nil {
		return err
	}

	deliveries := make(chan delivery, 32)
	errorsSeen := make(chan error, 4)
	beacon := newClient(brokerURL, "external-beacon", subscriber, password, deliveries, errorsSeen)
	if err := connect(beacon, timeout); err != nil {
		return fmt.Errorf("connect Beacon subscriber: %w", err)
	}
	defer beacon.Disconnect(250)
	if err := waitToken(beacon.Subscribe("meshcore/#", 1, nil), timeout); err != nil {
		return fmt.Errorf("subscribe Beacon to meshcore/#: %w", err)
	}

	observer := newClient(brokerURL, "external-observer", "v1_"+publicKey, token, nil, errorsSeen)
	if err := connect(observer, timeout); err != nil {
		return fmt.Errorf("connect firmware-style observer: %w", err)
	}
	defer observer.Disconnect(250)

	topics := map[string]string{
		"status":    fmt.Sprintf(`{"origin_id":"%s","SNR":7,"stats":{"uptime":1}}`, publicKey),
		"packets":   fmt.Sprintf(`{"origin_id":"%s","raw":"0200","RSSI":-90}`, publicKey),
		"neighbors": fmt.Sprintf(`{"origin_id":"%s","neighbors":[{"id":"node","SNR":9}]}`, publicKey),
	}
	for _, subtopic := range []string{"status", "packets", "neighbors"} {
		qos := byte(0)
		if subtopic == "status" {
			qos = 1
		}
		topic := fmt.Sprintf("meshcore/%s/%s/%s", iata, publicKey, subtopic)
		if err := waitToken(observer.Publish(topic, qos, true, topics[subtopic]), timeout); err != nil {
			return fmt.Errorf("publish %s: %w", subtopic, err)
		}
	}
	if _, err := collect(deliveries, errorsSeen, 3, false, timeout); err != nil {
		return fmt.Errorf("live delivery: %w", err)
	}

	beacon.Disconnect(250)
	replayed := make(chan delivery, 32)
	beacon = newClient(brokerURL, "external-beacon-reconnected", subscriber, password, replayed, errorsSeen)
	if err := connect(beacon, timeout); err != nil {
		return fmt.Errorf("reconnect Beacon subscriber: %w", err)
	}
	if err := waitToken(beacon.Subscribe("meshcore/#", 1, nil), timeout); err != nil {
		return fmt.Errorf("resubscribe Beacon to meshcore/#: %w", err)
	}
	if _, err := collect(replayed, errorsSeen, 3, true, timeout); err != nil {
		return fmt.Errorf("retained replay: %w", err)
	}

	for subtopic := range topics {
		topic := fmt.Sprintf("meshcore/%s/%s/%s", iata, publicKey, subtopic)
		if err := waitToken(observer.Publish(topic, 0, true, []byte{}), timeout); err != nil {
			return fmt.Errorf("clear retained %s: %w", subtopic, err)
		}
	}
	return nil
}

func observerToken(privateKey ed25519.PrivateKey, publicKey, audience string, now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "Ed25519", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims{
		PublicKey: publicKey,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
		Audience:  audience,
	})
	if err != nil {
		return "", err
	}
	encode := base64.RawURLEncoding.EncodeToString
	unsigned := encode(header) + "." + encode(payload)
	return unsigned + "." + hex.EncodeToString(ed25519.Sign(privateKey, []byte(unsigned))), nil
}

func newClient(brokerURL, clientID, username, password string, messages chan<- delivery, failures chan<- error) mqtt.Client {
	options := mqtt.NewClientOptions().
		AddBroker(brokerURL).
		SetClientID(clientID).
		SetUsername(username).
		SetPassword(password).
		SetCleanSession(true).
		SetAutoReconnect(false).
		SetConnectRetry(false).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) { failures <- err })
	if messages != nil {
		options.SetDefaultPublishHandler(func(_ mqtt.Client, message mqtt.Message) {
			messages <- delivery{
				topic:    message.Topic(),
				payload:  append([]byte(nil), message.Payload()...),
				retained: message.Retained(),
			}
		})
	}
	return mqtt.NewClient(options)
}

func connect(client mqtt.Client, timeout time.Duration) error {
	return waitToken(client.Connect(), timeout)
}

func waitToken(token mqtt.Token, timeout time.Duration) error {
	if !token.WaitTimeout(timeout) {
		return errors.New("operation timed out")
	}
	return token.Error()
}

func collect(messages <-chan delivery, failures <-chan error, count int, mustBeRetained bool, timeout time.Duration) ([]delivery, error) {
	result := make([]delivery, 0, count)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for len(result) < count {
		select {
		case message := <-messages:
			if mustBeRetained && !message.retained {
				return nil, fmt.Errorf("%s was not marked retained", message.topic)
			}
			if !json.Valid(message.payload) {
				return nil, fmt.Errorf("%s payload is not JSON", message.topic)
			}
			result = append(result, message)
		case err := <-failures:
			return nil, err
		case <-timer.C:
			topics := make([]string, 0, len(result))
			for _, message := range result {
				topics = append(topics, message.topic)
			}
			sort.Strings(topics)
			return nil, fmt.Errorf("timed out after %d/%d messages (%v)", len(result), count, topics)
		}
	}
	return result, nil
}
