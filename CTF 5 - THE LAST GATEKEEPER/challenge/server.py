#!/usr/bin/env python3
import os, socketserver, subprocess, threading, socket
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "31337"))
BINARY = os.path.join(os.path.dirname(__file__), "gatekeeper")

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        p = None
        try:
            p = subprocess.Popen([BINARY], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL)
            def pump_out():
                try:
                    while True:
                        data = os.read(p.stdout.fileno(), 4096)
                        if not data:
                            break
                        self.request.sendall(data)
                except OSError:
                    pass
                finally:
                    # Child stdout is closed once it exits. Let the client see EOF
                    # instead of leaving the TCP session waiting for more input.
                    try:
                        self.request.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass

            def watch_child():
                try:
                    p.wait()
                finally:
                    try:
                        self.request.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

            t_out = threading.Thread(target=pump_out, daemon=True)
            t_watch = threading.Thread(target=watch_child, daemon=True)
            t_out.start()
            t_watch.start()
            try:
                while True:
                    data = self.request.recv(4096)
                    if not data:
                        break
                    if p.poll() is not None:
                        break
                    p.stdin.write(data)
                    p.stdin.flush()
            except OSError:
                pass
        finally:
            if p is not None and p.poll() is None:
                try:
                    p.kill()
                except ProcessLookupError:
                    pass
                try:
                    p.wait(timeout=1)
                except Exception:
                    pass
            try:
                self.request.close()
            except OSError:
                pass

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    with Server((HOST, PORT), Handler) as s:
        print(f"split-seal gatekeeper listening on {HOST}:{PORT}", flush=True)
        s.serve_forever()
