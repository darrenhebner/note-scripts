import { $ } from "bun";
import { db, prepareDatabase } from "./utilities";

await prepareDatabase();

const topics = db.query("SELECT * from topics").all();

const selection = await $`echo ${topics
  .map((topic) => `${topic.topic}\t${topic.embedding}`)
  .join("\n")}| fzf --delimiter='\t' --with-nth=1`.text();
const [, embedding] = selection.split("\t");

await $`bun run ${import.meta.dir}/semantic_search.ts --embedding=${embedding}`;
