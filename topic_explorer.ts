import { $ } from "bun";
import { db, prepareDatabase } from "./utilities";

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
  await $`bun run ${
    import.meta.dir
  }/semantic_search.ts --embedding=${embedding}`;
} else if (query) {
  await $`bun run ${import.meta.dir}/semantic_search.ts --query="${query}"`;
}
