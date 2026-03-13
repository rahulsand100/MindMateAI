import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";

const db = new Database("mindmate.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS moods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    mood TEXT,
    date TEXT,
    note TEXT
  );
`);

// Migration: Add note column if it doesn't exist (for existing databases)
try {
  db.prepare("SELECT note FROM moods LIMIT 1").get();
} catch (e) {
  try {
    db.exec("ALTER TABLE moods ADD COLUMN note TEXT;");
    console.log("Added 'note' column to 'moods' table.");
  } catch (alterError) {
    console.error("Failed to add 'note' column:", alterError);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/moods", (req, res) => {
    // Increase limit to 100 to support calendar/history views
    const moods = db.prepare("SELECT * FROM moods ORDER BY date DESC LIMIT 100").all();
    res.json(moods);
  });

  app.post("/api/moods", (req, res) => {
    const { mood, date, note } = req.body;
    const info = db.prepare("INSERT INTO moods (userId, mood, date, note) VALUES (?, ?, ?, ?)").run("anonymous", mood, date, note || null);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete("/api/moods/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM moods WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
