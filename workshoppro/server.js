const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const FormData = require("form-data");
const Mailgun = require("mailgun.js");

loadEnvFile(path.join(__dirname, ".env"));

const SITE_ROOT = path.join(__dirname, "site");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "5190", 10);
const MAX_BODY_SIZE = 32 * 1024;

const REQUIRED_FIELDS = [
  "workshop_name",
  "contact_person",
  "phone",
  "email",
  "improvement_focus",
];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const mailgunClient = createMailgunClient();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

    if (request.method === "POST" && url.pathname === "/api/demo-request") {
      await handleDemoRequest(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    await serveStaticFile(url.pathname, response, request.method);
  } catch (error) {
    console.error("Unhandled request error:", error);
    sendJson(response, 500, { error: "Internal server error." });
  }
});

server.listen(PORT, HOST, () => {
  const mailgunReady = Boolean(
    process.env.MAILGUN_API_KEY &&
      process.env.MAILGUN_DOMAIN &&
      getNotificationRecipients().length > 0
  );

  console.log(`WorkshopPro site listening on http://${HOST}:${PORT}`);
  console.log(
    mailgunReady
      ? "Mailgun demo request delivery is configured."
      : "Mailgun demo request delivery is not fully configured yet."
  );
});

async function handleDemoRequest(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }

    throw error;
  }

  const payload = normalizePayload(body);

  if (payload.website) {
    sendJson(response, 200, { ok: true });
    return;
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return;
  }

  const recipients = getNotificationRecipients();
  if (!mailgunClient || recipients.length === 0) {
    console.error("Mailgun is not configured. Set MAILGUN_API_KEY, MAILGUN_DOMAIN, and DEMO_REQUEST_TO.");
    sendJson(response, 500, {
      error: "Email delivery is not configured on the server.",
    });
    return;
  }

  try {
    const mailgunDomain = process.env.MAILGUN_DOMAIN;
    const fromName = process.env.MAILGUN_FROM_NAME || "EdgePoint WorkshopPro";
    const fromEmail = process.env.MAILGUN_FROM_EMAIL || `postmaster@${mailgunDomain}`;
    const replyTo = payload.email;

    await mailgunClient.messages.create(mailgunDomain, {
      from: `${fromName} <${fromEmail}>`,
      to: recipients,
      subject: `New demo request: ${payload.workshop_name}`,
      text: buildTextEmail(payload),
      "h:Reply-To": replyTo,
    });

    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Mailgun send failed:", error);
    sendJson(response, 502, {
      error: "The request was received, but the email could not be sent.",
    });
  }
}

async function serveStaticFile(requestPath, response, method) {
  const normalizedPath = decodeURIComponent(requestPath);
  const filePath = resolveStaticPath(normalizedPath);

  if (!filePath) {
    sendNotFound(response);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[ext] || "application/octet-stream";

  const stat = await fs.promises.stat(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
  });

  if (method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath).pipe(response);
}

function resolveStaticPath(requestPath) {
  let relativePath = requestPath;
  if (relativePath === "/") {
    relativePath = "/index.html";
  }

  const candidatePaths = [];
  if (relativePath.endsWith("/")) {
    candidatePaths.push(path.join(SITE_ROOT, relativePath, "index.html"));
  } else {
    candidatePaths.push(path.join(SITE_ROOT, relativePath));
    candidatePaths.push(path.join(SITE_ROOT, relativePath, "index.html"));
  }

  for (const candidatePath of candidatePaths) {
    const resolved = path.resolve(candidatePath);
    if (!resolved.startsWith(SITE_ROOT)) {
      continue;
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  return null;
}

function normalizePayload(body) {
  const payload = {};
  const fields = [...REQUIRED_FIELDS, "staff_count", "website"];
  for (const field of fields) {
    const value = typeof body?.[field] === "string" ? body[field] : "";
    payload[field] = value.trim();
  }
  return payload;
}

function validatePayload(payload) {
  for (const field of REQUIRED_FIELDS) {
    if (!payload[field]) {
      return "Please complete all required fields.";
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Please enter a valid email address.";
  }

  const maxFieldLengths = {
    workshop_name: 120,
    contact_person: 120,
    phone: 50,
    email: 160,
    staff_count: 40,
    improvement_focus: 4000,
    website: 120,
  };

  for (const [field, maxLength] of Object.entries(maxFieldLengths)) {
    if (payload[field] && payload[field].length > maxLength) {
      return "One or more fields are too long.";
    }
  }

  return null;
}

function buildTextEmail(payload) {
  return [
    "A new demo request was submitted from workshoppro.edgepoint.co.nz.",
    "",
    `Workshop name: ${payload.workshop_name}`,
    `Contact person: ${payload.contact_person}`,
    `Phone: ${payload.phone}`,
    `Email: ${payload.email}`,
    `Number of staff: ${payload.staff_count || "Not provided"}`,
    "",
    "What they want to improve:",
    payload.improvement_focus,
  ].join("\n");
}

function createMailgunClient() {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    return null;
  }

  const mailgun = new Mailgun(FormData);
  const options = {
    username: "api",
    key: process.env.MAILGUN_API_KEY,
  };

  if (process.env.MAILGUN_BASE_URL) {
    options.url = process.env.MAILGUN_BASE_URL;
  }

  return mailgun.client(options);
}

function getNotificationRecipients() {
  return (process.env.DEMO_REQUEST_TO || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
      if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_SIZE) {
        fail(new RequestBodyError(413, "Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (settled) {
        return;
      }

      if (!rawBody) {
        settled = true;
        resolve({});
        return;
      }

      try {
        settled = true;
        resolve(JSON.parse(rawBody));
      } catch (error) {
        fail(new RequestBodyError(400, "Invalid JSON body."));
      }
    });

    request.on("error", (error) => {
      if (!settled) {
        fail(error);
      }
    });
  });
}

class RequestBodyError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendNotFound(response) {
  const body = "Not found";
  response.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const file = fs.readFileSync(filePath, "utf8");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
