# Machine Learning Research

## Overview

//mention rerankers and why, attention mechanism

## Testing pipeline diagrams
### Retrieval - effect of chunking/embedding/enrichment methods
![Chunk/embed/enrich_architecture](ml_images/chunking.png)
### Generation - effect of gold chunk position
![Generation_architecture](ml_images/retrievalcoloured.png)
# Results

## Core Retrieval Experiments
These experiments evaluate the main retrieval pipeline: chunking, embedding, retrieval method, reranking, and retrieval budget. Each plot is followed by its explanation.

### Chunking, embedding and enrichment

![Budget retrieval metrics by method](ml_images/results/budget_retrieval_metrics_by_method.png)

Top left plot shows that for all chunk sizes- increasing the token budget improves recall, i.e. more chunks are more likely to contain the answer.

![Chunk size metrics across methods](ml_images/results/chunk_size_metrics_all_methods.png)

Unnormalized by chunk size, unsurprisingly the largest chunk size (1024 tokens) performs best.
![Token-normalized scores](ml_images/results/token_normalized_scores_all.png)
Normalized for chunk size (i.e. for the same token budget broken up by different chunking methods), the smallest chunks (64 token) do best- i.e. several small chunks have a greater chance of catching the answer, then few bigger ones.

![Chunk size metrics by embedder](ml_images/results/chunk_size_metrics_by_embedder.png)

EmbeddingGemma300M was found to be the best embedder, followed by miniLM and GTE-modertBERT.

![Fixed 256-token surface metrics by style](ml_images/results/fixed_256_surface_metrics_by_style.png)

Removing the description (contains the name of the Document/Contract) or replacing the text with atomic statements, questions or summary - actually did not reduce performance much. This implies that the content of the chunk is very similar in embedding latent space to its summary, questions about it, and its atomic statement form. Also ablating (removing) the name did not actually decrease performance much so the embedder judged chunks well just via content without even knowing which contract the chunk came from.

### Reranking

![Reranker](ml_images/results/reranker_budget_metrics_by_condition.png)
Top-left plot is most important. It shows that for both Hybrid and BM25/Keyword search, reranknig significantly improves recall. This was the most notable finding in all research performed- that rerankers are extremely powerful. Note that the least powerful embedder-  the square, miniLM (22M), with reranking (22M) is far better than all of the embedders (e.g. Gemma 300M) without reranking, both for hybrid and semantic search. 

Without reranking (thin lines) keyword > hybrid > semantic search. Though with reranking hybrid and keywords are equivalent, and optimal.

![Reranker budget recall by method](ml_images/results/reranker_budget_recall_by_method.png)

All search methods were improved by reranker but primarily keyword and hybrid, perhaps since they found the best chunks but didn't rank them to the top by default.

![Reranker budget delta](ml_images/results/reranker_budget_reranker_delta.png)

Top-left: reranking caused the highest gains for hybrid, followed by keyword search. Semantic search shows small(er) gains with reranking (in this batch of experiments at least). This suggests that hybrid had a lot of useful chunks that were not ranked correctly- that the reranker was then able to place at the top (in the top k=5).


![Gemma rerank](ml_images/results/gemmarerank.png)

For Gemma (the best embedder, as seen in the embedding tests) reranking improves recall a lot for both hybrid and BM25 search.


## Lost-in-the-Middle / Context Position Experiments

These experiments investigate whether the accuracy of the LLM's answer changes depending on where the "gold" relevant chunk is placed in its context. (_see earlier diagram for pipeline_)
 
| Plot | Description |
|---|---|
| ![SWAMP evaluation plot](ml_images/results/swamp_eval_plot.png) | With more chunks - the LLM gets "swamped" and accuracy decreases, mainly due to abstentions e.g. "the answer is not provided in the given context". |
| ![Primacy boost](ml_images/results/primacyboost.png) | A modest primacy boost was found, moreso than the classic U shaped lost-in-the middle-curve. (i.e. The model is more accurate with the gold chunk at the start) |


## References




