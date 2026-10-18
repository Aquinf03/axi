---
name: review-sweep
description: List changed files → foreach review → merge findings
version: 1
---

# review-sweep

Lists changed files, reviews each in parallel (foreach), then merges findings.

```machine-spec
{
  "name": "review-sweep",
  "max_parallel": 4,
  "nodes": [
    {
      "id": "files",
      "name": "files-source",
      "prompt": "List files changed on this branch vs main (or HEAD~1). Return only a fenced json block: {\"files\": [\"path\", ...]}."
    },
    {
      "id": "review",
      "name": "file-reviewer",
      "needs": ["files"],
      "foreach": { "over": "files", "path": "files", "max": 8 },
      "prompt": "Review this one file for merge-blocking defects. Reply one line: `<path>: <problem or clean>`.\n\nFile: {item}"
    },
    {
      "id": "report",
      "name": "review-aggregator",
      "needs": ["files", "review"],
      "prompt": "Merge into a short prioritized issue list. Deduplicate.\n\nFILES:\n{files}\n\nREVIEWS:\n{review}"
    }
  ]
}
```
