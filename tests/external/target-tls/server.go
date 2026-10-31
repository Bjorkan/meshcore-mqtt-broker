package main

import (
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
)

func main() {
	address := flag.String("listen", "127.0.0.1:28883", "listen address")
	certificate := flag.String("cert", "", "server certificate")
	key := flag.String("key", "", "server private key")
	flag.Parse()
	if *certificate == "" || *key == "" {
		log.Fatal("-cert and -key are required")
	}
	pair, err := tls.LoadX509KeyPair(*certificate, *key)
	if err != nil {
		log.Fatal(err)
	}
	listener, err := tls.Listen("tcp", *address, &tls.Config{
		Certificates: []tls.Certificate{pair},
		MinVersion:   tls.VersionTLS12,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	log.Printf("synthetic TLS MQTT target listening on %s", *address)
	for {
		connection, err := listener.Accept()
		if err != nil {
			log.Fatal(err)
		}
		go serve(connection)
	}
}

func serve(connection net.Conn) {
	defer connection.Close()
	header, _, err := readPacket(connection)
	if err != nil {
		return
	}
	if header>>4 != 1 {
		return
	}
	if _, err := connection.Write([]byte{0x20, 0x02, 0x00, 0x00}); err != nil {
		return
	}
	for {
		header, _, err := readPacket(connection)
		if err != nil {
			return
		}
		switch header >> 4 {
		case 12:
			if _, err := connection.Write([]byte{0xd0, 0x00}); err != nil {
				return
			}
		case 14:
			return
		}
	}
}

func readPacket(reader io.Reader) (byte, []byte, error) {
	var first [1]byte
	if _, err := io.ReadFull(reader, first[:]); err != nil {
		return 0, nil, err
	}
	remaining := 0
	multiplier := 1
	for count := 0; count < 4; count++ {
		var encoded [1]byte
		if _, err := io.ReadFull(reader, encoded[:]); err != nil {
			return 0, nil, err
		}
		remaining += int(encoded[0]&127) * multiplier
		if encoded[0]&128 == 0 {
			if remaining > 1024*1024 {
				return 0, nil, fmt.Errorf("MQTT packet too large: %d", remaining)
			}
			payload := make([]byte, remaining)
			_, err := io.ReadFull(reader, payload)
			return first[0], payload, err
		}
		multiplier *= 128
	}
	return 0, nil, errors.New("invalid MQTT remaining length")
}
