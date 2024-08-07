import { $ } from "bun";
import { parseArgs } from "util";
import { ai, db } from "./utilities";

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    query: {
      type: "string",
    },
    embedding: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: true,
});

let queryEmbedding;

if (values.embedding) {
  queryEmbedding = JSON.parse(values.embedding.trim());
} else {
  if (!values.query || values.query.length === 0) {
    throw new Error("A --query argument was not provided");
  }

  queryEmbedding = (
    await ai.embeddings.create({
      input: values.query,
      model: "text-embedding-3-large",
    })
  ).data[0].embedding;
}

class Embedding {
  file: string;
  embedding: string;
  content: string;

  similarity(reference: number[]) {
    const embedding = JSON.parse(this.embedding) as number[];
    const dotProduct = reference.reduce(
      (sum, val, i) => sum + val * embedding[i],
      0
    );
    const magnitudeA = Math.sqrt(
      reference.reduce((sum, val) => sum + val * val, 0)
    );
    const magnitudeB = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    return dotProduct / (magnitudeA * magnitudeB);
  }
}

const allEmbeddings = db
  .query("SELECT file, embedding, content FROM embeddings")
  .as(Embedding)
  .all();

const sortedByRelevance = allEmbeddings.sort(
  (a, b) => b.similarity(queryEmbedding) - a.similarity(queryEmbedding)
);

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

await $`echo ${(
  await Promise.all(
    sortedByRelevance.map(
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

// send results to fzf
// handle 'enter' when in fzf select (send to vim in left panel)
