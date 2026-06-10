# Machine Learning Research

## Overview

## Testing pipeline diagrams
### Retrieval - effect of chunking/embedding/enrichment methods
![Chunk/embed/enrich_architecture](ml_images/chunking.png)
### Generation - effect of gold chunk position
![Generation_architecture](ml_images/retrievalcoloured.png)
# Results

## Core Retrieval Experiments
These experiments evaluate the main retrieval pipeline: chunking, embedding, retrieval method, reranking, and retrieval budget.
### Chunking, embedding and enrichment

![Budget retrieval metrics by method](ml_images/results/budget_retrieval_metrics_by_method.png)

Top left plot shows that for all chunk sizes- increasing the token budget improves recall, i.e. more chunks are more likely to contain the answer.

![Chunk size metrics across methods](ml_images/results/chunk_size_metrics_all_methods.png)

Unnormalized by chunk size, unsurprisingly the largest chunk size (1024 tokens) performs best.
![Token-normalized scores](ml_images/results/token_normalized_scores_all.png)

![Chunk size metrics by embedder](ml_images/results/chunk_size_metrics_by_embedder.png)

EmbeddingGemma300M was found to be the best embedder, followed by miniLM and GTE-modertBERT.

![Fixed 256-token surface metrics by style](ml_images/results/fixed_256_surface_metrics_by_style.png)

Removing the description (contains the name of the Document/Contract) or replacing the text with atomic statements, questions or summary - actually did not reduce performance much. This implies that the content of the chunk is very similar in embedding latent space to its summary, questions about it, and its atomic statement form. Also ablating (removing) the name did not actually decrease performance much so the embedder judged chunks well just via content without even knowing which contract the chunk came from.

### Reranking

![Reranker](ml_images/results/reranker_budget_metrics_by_condition.png)

![Reranker budget recall by method](ml_images/results/reranker_budget_recall_by_method.png)

![Reranker budget delta](ml_images/results/reranker_budget_reranker_delta.png)

![Gemma rerank](ml_images/results/gemmarerank.png)



## Lost-in-the-Middle / Context Position Experiments

These experiments investigate whether the quality of the answer changes depending on where relevant retrieved chunks are placed in the model context.

| Plot | Description |
|---|---|
| ![SWAMP evaluation plot](ml_images/results/swamp_eval_plot.png) | With more chunks - the LLM gets "swamped" and accuracy decreases, mainly due to abstentions e.g. "the answer is not provided in the given context". |
| ![Primacy boost](ml_images/results/primacyboost.png) | A modest primacy boost (the model is more accurate with the gold chunk at the start) was found, moreso than the classic U shaped lost-in-the middle-curve. |





