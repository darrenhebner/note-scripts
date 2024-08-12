import { $ } from "bun";
import { ai, db, prepareDatabase } from "./utilities";
import { getRelevantEmbeddings } from "./semantic_search";

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
          `${embedding.content.replace(/[\r\n]+/g, " ")}\t${embedding.file}\t${
            embedding.start
          }:${embedding.end}`
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
    const stream = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are a research assistant that uses a set of relevant notes to answer the users questions. Here are some relevant notes from the users daily logs.

${embeddings.slice(0, 5).map(
  (embedding) => `
  Title: ${embedding.file}

  Content: ${embedding.content}
  `
)}
`,
        },
        { role: "user", content: query },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content || "");
    }
  } else {
    await $`echo ${(
      await Promise.all(
        embeddings.map(
          async (embedding) =>
            `${embedding.content.replace(/[\r\n]+/g, " ")}\t${
              embedding.file
            }\t${embedding.start}:${embedding.end}`
        )
      )
    )
      .slice(0, 10)
      .join(
        "\n"
      )} | fzf --delimiter='\t' --with-nth=1 --preview "bat {2} --language md --style plain --color always --highlight-line {3}" --preview-window wrap`;
  }
}
