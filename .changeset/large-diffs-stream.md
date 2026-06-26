---
"@algoux/standard-ranklist-cli": patch
---

Stream git blobs when rendering diff previews so large changed `.srk.json` files no longer hit child-process stdout buffer limits.
