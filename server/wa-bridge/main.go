// wa-bridge — ponte WhatsApp (whatsmeow) para o bot da missão do SkyRescue.
//
// Faz UMA coisa: liga um número de WhatsApp ao servidor Node. Não tem regra
// de negócio — o Node decide o que responder (server/src/whatsapp.js).
//
//   POST /send {"to":"5571...@s.whatsapp.net|...@g.us","text":"..."}  -> envia
//   mensagem recebida -> POST $WA_WEBHOOK {chat,sender,name,text,isGroup,id}
//
// Sessão fica em $WA_DB (sqlite). Sem sessão: pareia por código (WA_PAIR_PHONE,
// digita no celular em Aparelhos conectados) ou pelo QR impresso no log.
// Segredo compartilhado com o Node em WA_SECRET (header X-WA-Secret).
package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	_ "modernc.org/sqlite"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

var (
	webhook = env("WA_WEBHOOK", "http://127.0.0.1:3012/api/wa/inbound")
	secret  = os.Getenv("WA_SECRET")
	client  *whatsmeow.Client
)

func main() {
	if secret == "" {
		log.Fatal("WA_SECRET obrigatório (mesmo valor no .env do Node)")
	}
	ctx := context.Background()
	// modernc é sqlite puro-Go (binário cross-compila sem cgo); o whatsmeow só
	// conhece o dialeto "sqlite3", então registramos o driver com esse nome.
	sql.Register("sqlite3", sqliteDriver())
	container, err := sqlstore.New(ctx, "sqlite3", "file:"+env("WA_DB", "wa-session.db")+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", waLog.Stdout("DB", "WARN", true))
	if err != nil {
		log.Fatal(err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		log.Fatal(err)
	}
	client = whatsmeow.NewClient(device, waLog.Stdout("WA", "INFO", true))
	client.AddEventHandler(onEvent)

	if client.Store.ID == nil {
		qrChan, _ := client.GetQRChannel(ctx)
		if err := client.Connect(); err != nil {
			log.Fatal(err)
		}
		if phone := os.Getenv("WA_PAIR_PHONE"); phone != "" {
			code, err := client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
			if err != nil {
				log.Fatal("PairPhone: ", err)
			}
			log.Printf("CÓDIGO DE PAREAMENTO para %s: %s  (WhatsApp > Aparelhos conectados > Conectar com número)", phone, code)
		}
		go func() {
			for evt := range qrChan {
				if evt.Event == "code" {
					log.Println("Escaneie o QR abaixo em WhatsApp > Aparelhos conectados:")
					qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				} else if evt.Event == "timeout" {
					// QR expirou sem ninguém escanear: sair para o supervisor (pm2/systemd)
					// reiniciar e imprimir um QR novo — sem isso ficaria pendurado
					log.Println("QR expirou; reiniciando para gerar outro (ou defina WA_PAIR_PHONE)")
					os.Exit(3)
				} else {
					log.Println("login:", evt.Event)
				}
			}
		}()
	} else if err := client.Connect(); err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("/send", handleSend)
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "loggedIn": client.IsLoggedIn(), "connected": client.IsConnected()})
	})
	addr := env("WA_HTTP_ADDR", "127.0.0.1:3812")
	log.Println("wa-bridge escutando em", addr, "-> webhook", webhook)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-WA-Secret") != secret {
		http.Error(w, "forbidden", 403)
		return
	}
	var body struct{ To, Text string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.To == "" || body.Text == "" {
		http.Error(w, "to e text obrigatórios", 400)
		return
	}
	jid, err := types.ParseJID(body.To)
	if err != nil {
		http.Error(w, "jid inválido: "+err.Error(), 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	resp, err := client.SendMessage(ctx, jid, &waProto.Message{Conversation: proto.String(body.Text)})
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "id": resp.ID})
}

func onEvent(evt any) {
	switch v := evt.(type) {
	case *events.Message:
		if v.Info.IsFromMe {
			return
		}
		text := v.Message.GetConversation()
		if text == "" {
			text = v.Message.GetExtendedTextMessage().GetText()
		}
		if strings.TrimSpace(text) == "" {
			return
		}
		go deliver(map[string]any{
			"id": v.Info.ID, "chat": v.Info.Chat.String(), "sender": v.Info.Sender.ToNonAD().String(),
			"name": v.Info.PushName, "text": text, "isGroup": v.Info.IsGroup,
		})
	case *events.PairSuccess:
		log.Println("pareado como", v.ID)
	case *events.LoggedOut:
		log.Println("SESSÃO ENCERRADA no celular — apague o WA_DB e reinicie para parear de novo")
	case *events.Connected:
		log.Println("conectado ao WhatsApp")
	}
}

func deliver(payload map[string]any) {
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", webhook, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-WA-Secret", secret)
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		log.Println("webhook:", err)
		return
	}
	res.Body.Close()
	if res.StatusCode >= 300 {
		log.Println("webhook http", res.StatusCode, fmt.Sprint(payload["chat"]))
	}
}
