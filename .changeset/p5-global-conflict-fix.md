---
"@datanet/p5": patch
---

Fix p5.js warning "had problems creating the global function createDataNet" — the addon was manually setting `window.createDataNet` before p5 could promote it from `p5.prototype`, triggering a false naming conflict warning. p5 now handles global promotion automatically.
