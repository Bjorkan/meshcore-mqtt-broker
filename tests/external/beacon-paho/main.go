package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
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
		password  = flag.String("password", envOr("MQTT_PASSWORD", "secret"), "FULL_ACCESS password (prefer MQTT_PASSWORD)")
		audience  = flag.String("audience", "integration", "observer JWT audience")
		iata      = flag.String("iata", "STO", "allowed IATA code")
		timeout   = flag.Duration("timeout", 10*time.Second, "operation timeout")
		passive   = flag.Bool("passive", false, "only observe live and retained telemetry across reconnect; never publish")
		advert    = flag.Bool("advert", false, "publish synthetic signed advert and radio status to an isolated broker")
	)
	flag.Parse()
	if *advert {
		if err := publishAdvert(*brokerURL, *audience, *iata, *timeout); err != nil {
			fmt.Fprintln(os.Stderr, "advert ingress failed:", err)
			os.Exit(1)
		}
		return
	}
	if *passive {
		if err := observe(*brokerURL, *username, *password, *timeout); err != nil {
			fmt.Fprintln(os.Stderr, "passive Paho check failed:", err)
			os.Exit(1)
		}
		return
	}

	if err := run(*brokerURL, *username, *password, *audience, *iata, *timeout); err != nil {
		fmt.Fprintln(os.Stderr, "beacon-paho integration failed:", err)
		os.Exit(1)
	}
	fmt.Println("Beacon/Paho observer, QoS, reconnect and retained replay checks passed")
}

func run(brokerURL, subscriber, password, audience, iata string, timeout time.Duration) (resultErr error) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	publicKey := hex.EncodeToString(privateKey.Public().(ed25519.PublicKey))
	token, err := observerToken(privateKey, publicKey, audience, time.Now())
	if err != nil {
		return err
	}

	deliveries := make(chan delivery, 32)
	errorsSeen := make(chan error, 4)
	prefix := fmt.Sprintf("meshcore/%s/%s/", strings.ToUpper(iata), strings.ToUpper(publicKey))
	beacon := newClient(brokerURL, "external-beacon-"+publicKey[:12], subscriber, password, deliveries, errorsSeen)
	if err := connect(beacon, timeout); err != nil {
		return fmt.Errorf("connect Beacon subscriber: %w", err)
	}
	defer func() { beacon.Disconnect(250) }()
	if err := waitToken(beacon.Subscribe("meshcore/#", 1, nil), timeout); err != nil {
		return fmt.Errorf("subscribe Beacon to meshcore/#: %w", err)
	}

	observer := newClient(brokerURL, "external-observer-"+publicKey[:12], "v1_"+publicKey, token, nil, errorsSeen)
	if err := connect(observer, timeout); err != nil {
		return fmt.Errorf("connect firmware-style observer: %w", err)
	}
	defer observer.Disconnect(250)

	topics := map[string]string{
		"status":    fmt.Sprintf(`{"origin_id":"%s","SNR":7,"stats":{"uptime":1}}`, publicKey),
		"packets":   fmt.Sprintf(`{"origin_id":"%s","raw":"0200","RSSI":-90}`, publicKey),
		"neighbors": fmt.Sprintf(`{"origin_id":"%s","neighbors":[{"id":"node","SNR":9}]}`, publicKey),
	}
	defer func() {
		for subtopic := range topics {
			if err := waitToken(observer.Publish(prefix+subtopic, 1, true, []byte{}), timeout); err != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("clear retained %s: %w", subtopic, err))
			}
		}
	}()
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
	if _, err := collect(deliveries, errorsSeen, prefix, topics, false, timeout); err != nil {
		return fmt.Errorf("live delivery: %w", err)
	}

	beacon.Disconnect(250)
	replayed := make(chan delivery, 32)
	beacon = newClient(brokerURL, "external-reconnected-"+publicKey[:12], subscriber, password, replayed, errorsSeen)
	if err := connect(beacon, timeout); err != nil {
		return fmt.Errorf("reconnect Beacon subscriber: %w", err)
	}
	if err := waitToken(beacon.Subscribe("meshcore/#", 1, nil), timeout); err != nil {
		return fmt.Errorf("resubscribe Beacon to meshcore/#: %w", err)
	}
	if _, err := collect(replayed, errorsSeen, prefix, topics, true, timeout); err != nil {
		return fmt.Errorf("retained replay: %w", err)
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

func collect(messages <-chan delivery, failures <-chan error, prefix string, expected map[string]string, mustBeRetained bool, timeout time.Duration) ([]delivery, error) {
	result := make([]delivery, 0, len(expected))
	seen := make(map[string]bool)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for len(seen) < len(expected) {
		select {
		case message := <-messages:
			if !strings.HasPrefix(message.topic, prefix) {
				continue
			}
			subtopic := strings.TrimPrefix(message.topic, prefix)
			payload, ok := expected[subtopic]
			if !ok {
				continue
			}
			if message.retained != mustBeRetained || string(message.payload) != payload {
				return nil, fmt.Errorf("%s payload or retain flag differs", subtopic)
			}
			seen[subtopic] = true
			result = append(result, message)
		case err := <-failures:
			return nil, err
		case <-timer.C:
			topics := make([]string, 0, len(result))
			for _, message := range result {
				topics = append(topics, message.topic)
			}
			sort.Strings(topics)
			return nil, fmt.Errorf("timed out after %d/%d topics (%v)", len(seen), len(expected), topics)
		}
	}
	return result, nil
}

func envOr(name, fallback string) string {
	if value, ok := os.LookupEnv(name); ok {
		return value
	}
	return fallback
}

func observe(url, username, password string, timeout time.Duration) error {
	for attempt := 0; attempt < 2; attempt++ {
		messages := make(chan delivery, 8192)
		failures := make(chan error, 4)
		client := newClient(url, fmt.Sprintf("issue273-passive-%d-%d", time.Now().UnixNano(), attempt), username, password, messages, failures)
		if err := connect(client, timeout); err != nil {
			return err
		}
		err := func() error {
			defer client.Disconnect(250)
			if err := waitToken(client.Subscribe("meshcore/#", 1, nil), timeout); err != nil {
				return err
			}
			live, retained := map[string]int{}, map[string]int{}
			timer := time.NewTimer(timeout)
			defer timer.Stop()
			for {
				select {
				case m := <-messages:
					parts := strings.Split(m.topic, "/")
					if len(parts) != 4 {
						continue
					}
					switch parts[3] {
					case "status", "packets", "neighbors":
						if !json.Valid(m.payload) {
							return fmt.Errorf("invalid JSON in %s", parts[3])
						}
						if m.retained {
							retained[parts[3]]++
						} else {
							live[parts[3]]++
						}
					}
				case err := <-failures:
					return err
				case <-timer.C:
					fmt.Printf("passive connection %d: live=%v retained=%v\n", attempt+1, live, retained)
					if len(live) == 0 || len(retained) == 0 {
						return errors.New("did not observe both live and retained telemetry")
					}
					return nil
				}
			}
		}()
		if err != nil {
			return err
		}
	}
	return nil
}
