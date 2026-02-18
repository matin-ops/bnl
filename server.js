const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  "https://mindsofcreators.app.n8n.cloud/webhook-test/4355a6a7-59f8-46e5-b157-c4062fe832d3";

const indexPath = path.join(__dirname, "index.html");

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    fs.readFile(indexPath, (error, data) => {
      if (error) {
        res.writeHead(500);
        res.end("Failed to load page");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(data);
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/contact") {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", async () => {
      try {
        const response = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Test: "__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6",
          },
          body: rawBody,
        });

        if (!response.ok) {
          sendJson(res, 502, { error: "Upstream webhook failed" });
          return;
        }

        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 500, { error: "Failed to send request" });
      }
    });

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
