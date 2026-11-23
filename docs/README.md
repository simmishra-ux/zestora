# Zestora docs

Diagrams that explain how the project works. Every diagram has two forms, and both describe the same code.

| Folder | Format | Open it with |
|---|---|---|
| `mermaid/*.mmd` | Mermaid | GitHub, VS Code (Markdown Preview Mermaid), https://mermaid.live |
| `eraser/*.eraser` | Eraser.io diagram-as-code | https://app.eraser.io |

## Using the Eraser files
1. Sign in at **app.eraser.io** and create a **New file**.
2. Choose **Diagram** (not Doc) and pick the diagram type that matches the file name:
   - `*.cloud.eraser` -> *Cloud architecture diagram*
   - `*.erd.eraser` -> *Entity relationship diagram*
   - `*.sequence.eraser` -> *Sequence diagram*
   - `*.flow.eraser` -> *Flow chart*
3. Open the **code panel** (left side), select everything, and paste the file's contents. The diagram draws itself.
4. Edit either side: change the code, or drag things around on the canvas. Use **Export** for PNG, SVG or PDF.

If Eraser underlines a line in red, the usual causes are an icon name it doesn't know (delete the `[icon: ...]` part) or a node name containing punctuation. Names in these files are kept plain on purpose.

## Reading order
Start with `01-architecture`, then `02-database`, then follow one flow at a time (auth, browse, cart and coupons, order creation, payment). The Mermaid set also has the startup, admin, review and order-state diagrams.
