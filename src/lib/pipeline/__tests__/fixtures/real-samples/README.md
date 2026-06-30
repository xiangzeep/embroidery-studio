# Phase 2 Real Samples

This folder tracks real-world regression samples for the second optimization phase.

The tests intentionally use metadata instead of absolute local paths so they remain portable. The source files used to define the current baseline were:

- `c_00000.png` from `MSEmb_DATASET/embs_all_unaligned/trainX_c/`
- `e_00000.png` from `MSEmb_DATASET/embs_all_unaligned/trainX_e/`
- `embroidery (1).dst` and `embroidery (3).dst` from local generated downloads

Current regression concerns:

- Excessive function codes and jump runs.
- Visible unsafe connector lines.
- Missing right-middle detail in `e_00000` output.
- Messy slanted and bottom edge stitches compared with Wilcom-style output.
