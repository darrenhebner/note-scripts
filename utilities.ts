import { Database } from "bun:sqlite";
import path from "path";
import { readdir } from "node:fs/promises";
import OpenAI from "openai";

const dbPath = Bun.env.DB_LOCATION;
const notesPath = Bun.env.NOTES_LOCATION;
const OPEN_AI_KEY = Bun.env.OPEN_AI_KEY;

if (!OPEN_AI_KEY) {
  throw new Error("An open AI API key must be provided");
}

export const db = new Database(dbPath, { create: true });

export const ai = new OpenAI({
  apiKey: OPEN_AI_KEY,
  baseURL: Bun.env.OPEN_AI_BASE_URL,
});

export async function prepareDatabase() {
  // create sqlite database if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      last_modified INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL UNIQUE,
      embedding BLOB NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      file TEXT NOT NULL,
      embedding BLOB NOT NULL
    )
  `);

  // read all markdown files in the notes directory
  const fileNames = await readdir(notesPath);
  const files = fileNames.map((fileName) =>
    Bun.file(path.join(notesPath, fileName))
  );

  for (const file of files) {
    if (!file.name?.endsWith(".md")) {
      continue;
    }

    const fileExistsWithSameLastModified = db
      .query(
        `SELECT COUNT(*) AS count from notes WHERE file = $file AND last_modified = $lastModified;`
      )
      .get({ $file: file.name, $lastModified: file.lastModified });

    // Note for future self, for some reason I'm never finding a matching note. So I always end up creating a new embedding
    if (fileExistsWithSameLastModified.count > 0) {
      continue;
    }

    console.log("updating", file.name);

    const content = await file.text();
    const embedding = await ai.embeddings.create({
      input: content,
      model: "text-embedding-3-small",
    });

    db.run(
      `
      INSERT OR REPLACE INTO notes (file, content, embedding, last_modified)
      VALUES (?, ?, ?, ?)
    `,
      file.name,
      content,
      JSON.stringify(embedding.data[0].embedding),
      file.lastModified
    );

    // Query all existing themes
    const existingTopics = db.query(`SELECT * FROM topics`).all();

    // Extract themes from content, passing in existing themes
    const result = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 2500,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
Task:

You are given the contents of a daily note. Your task is to identify the main themes discussed in the note and output them as a list formatted in valid JSON. The JSON should contain simple and concise themes that capture the essence of the content without any explanation or supporting text. You will also be provided with a list of existing topics from other notes. You should try to reuse existing topics if they are similar to the topics identified in the current note. You may only introduce new topics if no existing topics are similar.

Instructions:

Read the provided daily note carefully.
Identify key themes: Look for recurring subjects or activities mentioned in the note.
Simplify the themes: Convert these into simple, concise keywords or phrases that represent each theme.
Output the themes as a JSON array: The JSON must contain only the list of themes in plain text, without any additional information.

Example input:
I went to the gym today. Later that evening, I went to a concert.

Example output:
{"topics": ["Exercise", "Live Music"]}

Existing topics:
${existingTopics.map((topic) => topic.topic).join(", ")} 
        `,
        },
        {
          role: "user",
          content: `
Here is the content of my daily note:
${content}
          `,
        },
      ],
    });

    try {
      const { topics } = JSON.parse(result.choices[0].message.content);

      for (const topic of topics) {
        if (existingTopics.includes(topic)) {
          continue;
        }

        const embedding = await ai.embeddings.create({
          input: topic,
          model: "text-embedding-3-small",
        });

        db.run(
          `
          INSERT OR REPLACE INTO topics (topic, embedding)
          VALUES (?, ?)
        `,
          topic,
          JSON.stringify(embedding.data[0].embedding)
        );
      }
    } catch (err) {
      console.error(`Could not parse`, result.choices[0].message.content);
    }

    // delete existing embeddings for file
    db.run(`DELETE from embeddings WHERE file = ?`, file.name);

    // chunk text via open ai
    const chunkResult = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
       You are given the contents of a daily note. Your task is to split the content in to chunks. When you encounter consecutive sentences that are talking about the same topic, group them in to the same chunk. The content will be provided in markdown format. 

You may only respond using valid JSON. The JSON must contain only the list of chunks in plain text, without any additional information. The chunks may only contain text that is a part of the daily note.

Example output:
{"chunks": ["I read a book this morning about architecture. It is really good.", "Dogs are my favourite animal."]}
`,
        },
        {
          role: "user",
          content: `
Here is the content of the daily note:
${content}
        `,
        },
      ],
    });

    try {
      const { chunks } = JSON.parse(chunkResult.choices[0].message.content);

      for (const chunk of chunks) {
        const embedding = await ai.embeddings.create({
          input: chunk,
          model: "text-embedding-3-small",
        });

        db.run(
          `
          INSERT INTO embeddings (content, file, embedding)
          VALUES (?, ?, ?)
        `,
          chunk,
          file.name,
          JSON.stringify(embedding.data[0].embedding)
        );
      }
    } catch (err) {
      console.error(
        "Unable to parse suggested chunks",
        chunkResult.choices[0].message.content
      );
      console.error(err);
    }
    // add embeddings to database
  }
}
