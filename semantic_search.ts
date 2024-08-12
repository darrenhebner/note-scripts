import { db } from "./utilities";

export class Embedding {
  file: string;
  embedding: string;
  content: string;
  start: number;
  end: number;

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

export async function getRelevantEmbeddings(embedding: number[]) {
  const allEmbeddings = db
    .query("SELECT file, embedding, content, start, end FROM embeddings")
    .as(Embedding)
    .all();

  const sortedByRelevance = allEmbeddings.sort(
    (a, b) => b.similarity(embedding) - a.similarity(embedding)
  );

  return sortedByRelevance;
}
