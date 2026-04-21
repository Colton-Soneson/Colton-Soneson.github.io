#Use to create local host
import http.server
import socketserver

#if files dont work, try another port (make sure its allowed through firewall)
PORT = 8000

#add any extensions needed here, just search ".extension MIME type" in google
Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
      ".js": "application/javascript",
	  ".wgsl": "text/wgsl",
});

httpd = socketserver.TCPServer(("", PORT), Handler)
httpd.serve_forever()