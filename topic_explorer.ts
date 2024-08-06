import { $ } from "bun";
import { db, prepareDatabase } from "./utilities";

await prepareDatabase();

// Query for all themes
// Pass list of themes to fzf
// On theme selection, find the similar notes
// Pass those to fzf
const topics = db.query("SELECT * from topics").all();

const selection = await $`echo ${topics
  .map((topic) => `${topic.topic}\t${topic.embedding}`)
  .join("\n")}| fzf --delimiter='\t' --with-nth=1`.text();
const [, embedding] = selection.split("\t");

await $`bun run ~/dotfiles/scripts/bin/semantic_search.ts --embedding=${embedding}`;
