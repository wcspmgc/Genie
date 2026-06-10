# Machine Learning Research

## Overview

## Testing pipeline diagrams
### Retrieval - effect of chunking/embedding/enrichment methods
![Chunk/embed/enrich_architecture](ml_images/chunking.png)
### Generation - effect of gold chunk position
![Generation_architecture](ml_images/retrievalcoloured.png)
## Results

### Core Retrieval Experiments

These experiments evaluate the main retrieval pipeline: chunking, embedding, retrieval method, reranking, and retrieval budget.

| Figure | Description |
|---|---|
| ![Budget retrieval metrics by method](ml_images/results/budget_retrieval_metrics_by_method.png) |  |
| ![Chunk size metrics across methods](ml_images/results/chunk_size_metrics_all_methods.png) | |
| ![Chunk size metrics by embedder](ml_images/results/chunk_size_metrics_by_embedder.png) | |
| ![Fixed 256-token surface metrics by style](ml_images/results/fixed_256_surface_metrics_by_style.png) |  |
| ![Reranker](ml_images/results/reranker.png) |  |
| ![Reranker budget recall by method](ml_images/results/reranker_budget_recall_by_method.png) |  |
| ![Reranker budget delta](ml_images/results/reranker_budget_reranker_delta.png) | |
| ![Gemma rerank](ml_images/results/gemmarerank.png) | |
| ![Token-normalized scores](ml_images/results/token_normalized_scores_all.png) | |

### Lost-in-the-Middle / Context Position Experiments

These experiments investigate whether answer quality changes depending on where relevant retrieved chunks are placed in the model context.

| Figure | Description |
|---|---|
| ![SWAMP evaluation plot](ml_images/results/swamp_eval_plot.png) | With more chunks - the LLM gets "swamped" and accuracy decreases, mainly due to abstentions e.g. "the answer is not provided in the given context". |
| ![Primacy boost](ml_images/results/primacyboost.png) | A modest primacy boost (the model is more accurate with the gold chunk at the start) was found, moreso than the classic U shaped lost in the middle curve. |





