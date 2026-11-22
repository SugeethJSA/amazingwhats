package socket

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var UDSPath = os.TempDir() + "/whats4linux.sock"

// CommandHandler is invoked for socket commands that aren't handled by the
// built-in window commands (show/hide/quit). It returns the reply to send back
// on the connection ("" for none) and whether the command was recognised.
type CommandHandler func(cmd string) (reply string, handled bool)

type UnixSocket struct {
	mu       sync.Mutex
	ctx      context.Context
	app      *application.App
	window   *application.WebviewWindow
	conn     net.Conn
	listener net.Listener
	handler  CommandHandler
	closed   bool
}

func NewUnixSocket(ctx context.Context) (*UnixSocket, error) {
	return &UnixSocket{
		ctx: ctx,
	}, nil
}

// SetTargets injects the Wails v3 objects used by the built-in show/hide/quit
// commands. v2 used context-bound runtime functions; v3 operates on the owning
// objects. Call before ListenAndServe.
func (s *UnixSocket) SetTargets(app *application.App, window *application.WebviewWindow) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.app = app
	s.window = window
}

// SetCommandHandler registers a handler for app-specific commands (e.g. the
// systray notification toggle). Must be set before ListenAndServe.
func (s *UnixSocket) SetCommandHandler(handler CommandHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handler = handler
}

func (s *UnixSocket) ListenAndServe() error {
	if err := os.RemoveAll(UDSPath); err != nil {
		return err
	}
	listener, err := net.Listen("unix", UDSPath)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = listener.Close()
		_ = os.Remove(UDSPath)
		return nil
	}
	s.listener = listener
	s.mu.Unlock()
	defer func() {
		_ = listener.Close()
		s.mu.Lock()
		if s.listener == listener {
			s.listener = nil
		}
		s.mu.Unlock()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			s.mu.Lock()
			closed := s.closed
			s.mu.Unlock()
			if closed {
				return nil
			}
			log.Println("accept error:", err)
			continue
		}
		s.handleConn(conn)
	}
}

// handleConn serves a single client (the systray) over a persistent
// connection. Commands are newline-delimited; replies/pushes are written back
// on the same connection via SendCommand.
func (s *UnixSocket) handleConn(conn net.Conn) {
	s.mu.Lock()
	s.conn = conn
	handler := s.handler
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		if s.conn == conn {
			s.conn = nil
		}
		s.mu.Unlock()
		_ = conn.Close()
	}()

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		msg := scanner.Text()
		if msg == "" {
			continue
		}

		s.mu.Lock()
		app, window := s.app, s.window
		s.mu.Unlock()

		switch msg {
		case "show":
			if window != nil {
				window.UnMinimise()
				window.Show()
			}
		case "hide":
			if window != nil {
				window.Hide()
			}
		case "quit":
			log.Println("Quit signal received from systray")
			if app != nil {
				app.Quit()
			}
		default:
			if handler != nil {
				if reply, handled := handler(msg); handled {
					if reply != "" {
						if err := s.SendCommand(reply); err != nil {
							log.Println("socket reply error:", err)
						}
					}
					continue
				}
			}
			fmt.Println("unknown command:", msg)
		}
	}
	if err := scanner.Err(); err != nil {
		log.Println("read error:", err)
	}
}

// SendCommand writes a newline-framed message to the connected client.
func (s *UnixSocket) SendCommand(cmd string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == nil {
		return fmt.Errorf("not connected to socket")
	}
	_, err := s.conn.Write([]byte(cmd + "\n"))
	if err != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
	return err
}

// Close stops the listener, closes the tray connection, and removes the socket
// file. It is safe to call more than once.
func (s *UnixSocket) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	listener := s.listener
	conn := s.conn
	s.listener = nil
	s.conn = nil
	s.mu.Unlock()

	var closeErr error
	if conn != nil {
		closeErr = conn.Close()
	}
	if listener != nil {
		if err := listener.Close(); closeErr == nil {
			closeErr = err
		}
	}
	if err := os.Remove(UDSPath); err != nil && !os.IsNotExist(err) && closeErr == nil {
		closeErr = err
	}
	return closeErr
}
