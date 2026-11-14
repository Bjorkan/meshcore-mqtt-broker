package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// This implements the firmware ADVERT wire format with fresh synthetic keys.
func publishAdvert(url, audience, iata string, timeout time.Duration) error {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	key := hex.EncodeToString(public)
	token, err := observerToken(private, key, audience, time.Now())
	if err != nil {
		return err
	}
	client := newClient(url, "synthetic-advert-"+key[:12], "v1_"+key, token, nil, make(chan error, 4))
	if err := connect(client, timeout); err != nil {
		return err
	}
	defer client.Disconnect(250)
	status, err := json.Marshal(map[string]any{"origin_id": key, "radio": "869.525,125,11,5"})
	if err != nil {
		return err
	}
	if err := waitToken(client.Publish(fmt.Sprintf("meshcore/%s/%s/status", iata, key), 1, false, status), timeout); err != nil {
		return err
	}
	stamp := make([]byte, 4)
	binary.LittleEndian.PutUint32(stamp, uint32(time.Now().Unix()))
	appData := []byte{0x02} // repeater, no location/name
	signed := append(append(append([]byte{}, public...), stamp...), appData...)
	packet := []byte{0x10, 0, 0, 0, 0, 0} // advert, transport code and empty path
	packet = append(packet, public...)
	packet = append(packet, stamp...)
	packet = append(packet, ed25519.Sign(private, signed)...)
	packet = append(packet, appData...)
	payload, err := json.Marshal(map[string]string{"origin_id": key, "raw": hex.EncodeToString(packet)})
	if err != nil {
		return err
	}
	return waitToken(client.Publish(fmt.Sprintf("meshcore/%s/%s/packets", iata, key), 1, false, payload), timeout)
}
