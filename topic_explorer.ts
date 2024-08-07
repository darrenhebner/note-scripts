import { $ } from "bun";
import { ai, db, prepareDatabase } from "./utilities";
import { getRelevantEmbeddings, type Embedding } from "./semantic_search";

await prepareDatabase();

const topics = db.query("SELECT * from topics").all();

const lines = $`echo ${topics
  .map((topic) => `${topic.topic}\t${topic.embedding}`)
  .join("\n")}| fzf --delimiter='\t' --with-nth=1 --print-query`.lines();

let query;
let selection;

for await (const line of lines) {
  if (query === undefined) {
    query = line ?? null;
    continue;
  }

  if (selection === undefined) {
    selection = line ?? null;
  }
}

if (selection) {
  const [, embedding] = selection.split("\t");
  const embeddings = await getRelevantEmbeddings(JSON.parse(embedding));

  await $`echo ${(
    await Promise.all(
      embeddings.map(
        async (embedding) =>
          `${embedding.content.replace(/[\r\n]+/g, " ")}\t${
            embedding.file
          }\t${await getRange(embedding)}`
      )
    )
  )
    .slice(0, 10)
    .join(
      "\n"
    )} | fzf --delimiter='\t' --with-nth=1 --preview "bat {2} --language md --style plain --color always --highlight-line {3}" --preview-window wrap`;
} else if (query) {
  const embedding = (
    await ai.embeddings.create({
      input: query,
      model: "text-embedding-3-large",
    })
  ).data[0].embedding;

  const embeddings = await getRelevantEmbeddings(embedding);

  if (query.endsWith("?")) {
    console.log("asking");
  } else {
    await $`echo ${(
      await Promise.all(
        embeddings.map(
          async (embedding) =>
            `${embedding.content.replace(/[\r\n]+/g, " ")}\t${
              embedding.file
            }\t${await getRange(embedding)}`
        )
      )
    )
      .slice(0, 10)
      .join(
        "\n"
      )} | fzf --delimiter='\t' --with-nth=1 --preview "bat {2} --language md --style plain --color always --highlight-line {3}" --preview-window wrap`;
  }
}

async function getRange(embedding: Embedding) {
  // load file
  const file = await Bun.file(embedding.file).text();

  // split file by new line
  const lines = file.split("\n");
  // iterate over lines

  const matchedLines: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length > 0 && embedding.content.includes(line)) {
      matchedLines.push(index + 1);
    }
  });

  if (matchedLines.length === 0) {
    return "1";
  }

  const start = Math.min(...matchedLines);
  const end = Math.max(...matchedLines);

  return `${start}:${end}`;
}
