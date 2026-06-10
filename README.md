# Genie

## Project complete, Demo - Work-in-progress

Genie is a desktop Retrieval Augmented Generation (RAG) app for locally querying your documents with AI.  
Welcome to my final year project showcase!

## Demo Video

[![Watch the Genie demo](app_images/playdemo.png)](https://www.youtube.com/watch?v=lA0Jj9-TSDw)

[Watch the demo on YouTube](https://www.youtube.com/watch?v=lA0Jj9-TSDw)

![Genie hero screenshot](app_images/hero.png)

## Overview

## Screenshots

<table border="0">
  <tr>
    <td width="50%"><img src="app_images/readme_grid/documents.png" alt="Documents screen"></td>
    <td width="50%"><img src="app_images/readme_grid/search.png" alt="Search screen"></td>
  </tr>
  <tr>
    <td width="50%"><img src="app_images/readme_grid/settings.png" alt="Settings screen"></td>
    <td width="50%"><img src="app_images/readme_grid/chatlight.png" alt="Light chat screen"></td>
  </tr>
  <tr>
    <td width="50%"><img src="app_images/readme_grid/chatdarkchunk.png" alt="Dark chat screen"></td>
    <td width="50%"><img src="app_images/readme_grid/models.png" alt="Models screen"></td>
  </tr>
  <tr>
    <td width="50%"><img src="app_images/readme_grid/signup.png" alt="Signup screen"></td>
    <td width="50%"><img src="app_images/readme_grid/loginlight.png" alt="Login screen"></td>
  </tr>
  <tr>
    <td ><img src="app_images/cybersecurity.png" alt="Cybersecurity screen" height=250></td>
    <td width="50%"><img src="app_images/appoutline.png" alt="App outline screen"></td>
  </tr>
</table>

## Features
- Chat with local LLM using Retrieval Augmented Generation (RAG)
- Upload and index documents
- Search documents using semantic, keyword (BM25), or hybrid retrieval
- View retrieved source chunks for transparency
- Configure retrieval and inference settings, including:
  - LLM model (`.gguf`)
  - context window
  - temperature
  - retrieval method
  - number of retrieved chunks
  - chunk size
  - reranking options
- Customize Interface
  - light and dark mode
  - font size
  - background image

## Technical summary

## Tech Stack

**Frontend**
- Electron
- React
- Material UI
- Vite

**Backend/AI**
- llama.cpp/llama-cpp-python
- sentence-transformers/SBERT
- MiniLM Embeddings
- LanceDB (vector database)

**Languages**
- JavaScript
- Python

## Motivation
