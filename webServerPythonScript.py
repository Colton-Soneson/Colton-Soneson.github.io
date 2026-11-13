#Use to create local host
import http.server
import socketserver

#if files dont work, try another port (make sure its allowed through firewall)
PORT = 8000

# the browser told to ask again for every file (it gets a quick 'not modified' if nothing changed): without it, it may keep using an old
#	copy of a script after the code changes, the worker threads (code/tileWorker.js, code/terrainWorker.js) most of all
class Handler(http.server.SimpleHTTPRequestHandler):
	def end_headers(self):
		self.send_header('Cache-Control', 'no-cache')
		super().end_headers()
#add any extensions needed here, just search ".extension MIME type" in google
Handler.extensions_map.update({
      ".js": "application/javascript",
	  ".wgsl": "text/wgsl",
});

httpd = socketserver.TCPServer(("", PORT), Handler)
httpd.serve_forever()